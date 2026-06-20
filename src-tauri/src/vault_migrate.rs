//! One-time migration: lift the OLD app data (SQLite `memosa.db` + meeting folders)
//! into the files-only 3.0 vault (specs 01, 02, 12).
//!
//! This is the ONLY place the legacy database is read. It is opened read-only and is
//! never modified or deleted — the user removes `~/.memosa` / the old DB manually after
//! verifying the migration. Re-running is idempotent: a conversation already present in
//! the vault (matched by created-time + title) is skipped.

use crate::vault::{ConvMeta, Notes, Segment, Task, Transcript, Vault};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;

/// Summary of what the importer did (returned to the UI / CLI).
#[derive(Debug, Clone, Serialize, Default)]
pub struct MigrationReport {
    /// Conversations created in the vault this run.
    pub conversations: usize,
    /// Audio files copied in as `audio.m4a`.
    pub audio_copied: usize,
    /// Conversations skipped because they already exist (idempotent re-run).
    pub skipped: usize,
    /// Non-fatal per-meeting errors; migration continues past them.
    pub errors: Vec<String>,
}

/// A single legacy meeting row read from the old SQLite DB (read-only view).
struct OldMeeting {
    title: String,
    date: String,       // YYYY-MM-DD
    start_time: String, // HH:MM
    duration_seconds: u64,
    audio_path: String,
    transcript_path: Option<String>,
    folder_path: String,
    attendees: Vec<String>,
    tags: Vec<String>,
    people: Vec<String>,
    summary: Option<String>,
    action_items: Vec<String>,
    decisions: Vec<String>,
    calendar_event_id: Option<String>,
    whisper_model: Option<String>,
}

/// Locate the legacy SQLite database (`Application Support/com.memosa.app/memosa.db`).
fn legacy_db_path() -> std::path::PathBuf {
    crate::paths::app_data_dir().join("memosa.db")
}

/// Run the importer against the given vault root. Non-destructive to the old data.
pub fn migrate(vault_root: &Path) -> Result<MigrationReport, String> {
    let mut report = MigrationReport::default();

    let db_path = legacy_db_path();
    if !db_path.exists() {
        // Nothing to migrate — treat as a clean no-op rather than an error so the
        // command is safe to call on a fresh install.
        return Ok(report);
    }

    let vault = Vault::new(vault_root.to_path_buf());
    vault.ensure().map_err(|e| format!("Failed to prepare vault: {e}"))?;

    let meetings = read_legacy_meetings(&db_path)?;

    for meeting in meetings {
        match import_meeting(&vault, &meeting) {
            Ok(Outcome::Created { audio }) => {
                report.conversations += 1;
                if audio {
                    report.audio_copied += 1;
                }
            }
            Ok(Outcome::Skipped) => report.skipped += 1,
            Err(e) => report.errors.push(format!("{}: {}", meeting.title, e)),
        }
    }

    Ok(report)
}

/// Tauri command: migrate into the active vault (`vault_cmds::vault_root()`).
#[tauri::command]
pub fn vault_migrate_run() -> Result<MigrationReport, String> {
    let root = crate::vault_cmds::vault_root();
    migrate(&root)
}

enum Outcome {
    Created { audio: bool },
    Skipped,
}

/// Import one legacy meeting into the vault, or skip it if already present.
fn import_meeting(vault: &Vault, m: &OldMeeting) -> Result<Outcome, String> {
    let created = to_iso(&m.date, &m.start_time);
    let folder = pick_folder(m);

    // Idempotency: skip if a conversation with the same created-time + title already
    // exists in the target folder.
    if let Ok(existing) = vault.list(&folder) {
        if existing
            .iter()
            .any(|c| c.title == m.title && c.created == created)
        {
            return Ok(Outcome::Skipped);
        }
    }

    let id = vault
        .create_conversation(&folder, &m.title, &created)
        .map_err(|e| format!("create_conversation: {e}"))?;

    // ---- meta.json ----
    let mut meta = ConvMeta::new(id.clone(), m.title.clone(), created.clone());
    meta.duration_sec = m.duration_seconds;
    meta.people = merge_people(m);
    meta.tags = m.tags.clone();
    meta.source = "imported".to_string();
    meta.calendar_event_id = m.calendar_event_id.clone();
    vault.write_meta(&meta).map_err(|e| format!("write_meta: {e}"))?;

    // ---- transcript.json (+ derived .txt via the vault) ----
    let transcript = build_transcript(m);
    if !transcript.segments.is_empty() {
        vault
            .write_transcript(&id, &transcript)
            .map_err(|e| format!("write_transcript: {e}"))?;
    }

    // ---- notes.md (summary + decisions + action items) ----
    let notes = build_notes(m);
    vault.write_notes(&id, &notes).map_err(|e| format!("write_notes: {e}"))?;

    // ---- audio.m4a ----
    let audio = copy_audio(vault, &id, m)?;

    Ok(Outcome::Created { audio })
}

/// Choose a vault folder for a legacy meeting. Prefer the first tag as a domain,
/// otherwise fall back to `Imported/<YYYY>`.
fn pick_folder(m: &OldMeeting) -> String {
    if let Some(tag) = m.tags.iter().find(|t| !t.trim().is_empty()) {
        let clean = sanitize_segment(tag);
        if !clean.is_empty() {
            return format!("Imported/{}", clean);
        }
    }
    let year = m.date.get(..4).filter(|y| y.len() == 4).unwrap_or("Unknown");
    format!("Imported/{year}")
}

/// Sanitize a string for use as a single vault path segment (no `/`, no leading dot).
fn sanitize_segment(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == '\0' { '-' } else { c })
        .collect();
    cleaned.trim().trim_matches('.').trim().to_string()
}

/// Merge attendees + people into a deduped people list (people first).
fn merge_people(m: &OldMeeting) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in m.people.iter().chain(m.attendees.iter()) {
        let p = p.trim();
        if !p.is_empty() && !out.iter().any(|e| e.eq_ignore_ascii_case(p)) {
            out.push(p.to_string());
        }
    }
    out
}

/// Build a vault `Transcript` by parsing the legacy `transcript.md` (`[HH:MM:SS] text`).
fn build_transcript(m: &OldMeeting) -> Transcript {
    let raw = read_transcript_md(m);
    let segments = raw.map(|md| parse_transcript_md(&md)).unwrap_or_default();
    Transcript {
        schema: 1,
        language: String::new(),
        model: m.whisper_model.clone().unwrap_or_default(),
        speakers: Default::default(),
        segments,
    }
}

/// Read the legacy transcript markdown from `transcript_path`, falling back to
/// `transcript.md` inside the meeting folder.
fn read_transcript_md(m: &OldMeeting) -> Option<String> {
    if let Some(p) = m.transcript_path.as_ref().filter(|p| !p.is_empty()) {
        if let Ok(s) = std::fs::read_to_string(p) {
            return Some(s);
        }
    }
    let fallback = Path::new(&m.folder_path).join("transcript.md");
    std::fs::read_to_string(fallback).ok()
}

/// Parse `[HH:MM:SS] text` lines (the legacy transcript body) into vault segments.
/// Lines without a leading timestamp are appended to the previous segment's text.
fn parse_transcript_md(md: &str) -> Vec<Segment> {
    let mut segs: Vec<Segment> = Vec::new();
    for line in md.lines() {
        let line = line.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty() {
            continue;
        }
        // Skip headings / front-matter / hrules from the markdown header block.
        if trimmed.starts_with('#') || trimmed.starts_with("**") || trimmed == "---" {
            continue;
        }
        if let Some((secs, text)) = parse_ts_line(trimmed) {
            let text = text.trim().to_string();
            if text.is_empty() {
                continue;
            }
            segs.push(Segment {
                start: secs,
                end: secs,
                speaker: String::new(),
                text,
            });
        } else if let Some(last) = segs.last_mut() {
            // Continuation of the previous line.
            last.text.push(' ');
            last.text.push_str(trimmed);
        }
    }
    // Fill each segment's end with the next segment's start (best-effort).
    for i in 0..segs.len() {
        if i + 1 < segs.len() {
            segs[i].end = segs[i + 1].start;
        }
    }
    segs
}

/// Parse a `[HH:MM:SS] rest` or `[MM:SS] rest` prefix → (start_seconds, rest).
fn parse_ts_line(line: &str) -> Option<(f64, &str)> {
    let rest = line.strip_prefix('[')?;
    let close = rest.find(']')?;
    let stamp = &rest[..close];
    let after = rest[close + 1..].trim_start();
    let mut secs: u64 = 0;
    let mut any = false;
    for part in stamp.split(':') {
        let n: u64 = part.trim().parse().ok()?;
        secs = secs * 60 + n;
        any = true;
    }
    if !any {
        return None;
    }
    Some((secs as f64, after))
}

/// Build vault `Notes` (summary + decisions + action-item checkboxes) from a meeting.
fn build_notes(m: &OldMeeting) -> Notes {
    let summary = m.summary.clone().unwrap_or_default();
    let decisions: Vec<String> = m
        .decisions
        .iter()
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .collect();
    let actions: Vec<Task> = m
        .action_items
        .iter()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(|t| Task {
            conv: String::new(),
            text: t.to_string(),
            done: false,
            owner: None,
            due: None,
        })
        .collect();

    Notes {
        summary,
        decisions,
        actions,
        markdown: String::new(),
    }
}

/// Copy the legacy audio into the vault conversation as `audio.m4a`. Returns whether a
/// file was actually copied.
fn copy_audio(vault: &Vault, id: &str, m: &OldMeeting) -> Result<bool, String> {
    let src = Path::new(&m.audio_path);
    if m.audio_path.is_empty() || !src.exists() {
        return Ok(false);
    }
    let dest = vault.root().join(id).join("audio.m4a");
    if dest.exists() {
        return Ok(false);
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("audio dir: {e}"))?;
    }
    std::fs::copy(src, &dest).map_err(|e| format!("copy audio: {e}"))?;
    Ok(true)
}

/// Convert legacy `date` (YYYY-MM-DD) + `start_time` (HH:MM) into an ISO-8601 UTC stamp.
/// Falls back gracefully when the time is missing or malformed.
fn to_iso(date: &str, start_time: &str) -> String {
    let date = date.get(..10).unwrap_or(date);
    let time = start_time.trim();
    let (h, min) = match time.split_once(':') {
        Some((h, m)) => (
            h.trim().parse::<u32>().unwrap_or(0),
            m.get(..2).unwrap_or(m).trim().parse::<u32>().unwrap_or(0),
        ),
        None => (0, 0),
    };
    if let Ok(d) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        if let Some(naive) = d.and_hms_opt(h, min, 0) {
            let dt = chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc);
            return dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        }
    }
    // Last resort: a valid-looking ISO date at midnight.
    format!("{date}T00:00:00Z")
}

/// Read all meetings from the legacy DB, opened READ-ONLY. Never writes.
fn read_legacy_meetings(db_path: &Path) -> Result<Vec<OldMeeting>, String> {
    let conn = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Failed to open legacy DB read-only: {e}"))?;

    let mut stmt = conn
        .prepare(
            "SELECT title, date, start_time, duration_seconds, audio_path, transcript_path,
                    folder_path, attendees, tags, people, summary, action_items, decisions,
                    calendar_event_id, whisper_model
             FROM meetings
             ORDER BY date ASC, start_time ASC",
        )
        .map_err(|e| format!("Failed to prepare legacy query: {e}"))?;

    let rows = stmt
        .query_map([], |row| {
            let duration: i64 = row.get(3)?;
            let attendees_json: String = row.get::<_, Option<String>>(7)?.unwrap_or_default();
            let tags_json: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
            let people_json: String = row.get::<_, Option<String>>(9)?.unwrap_or_default();
            let action_items_json: String = row.get::<_, Option<String>>(11)?.unwrap_or_default();
            let decisions_json: String = row.get::<_, Option<String>>(12)?.unwrap_or_default();

            Ok(OldMeeting {
                title: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                date: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                start_time: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                duration_seconds: duration.max(0) as u64,
                audio_path: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                transcript_path: row.get::<_, Option<String>>(5)?,
                folder_path: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                attendees: parse_json_vec(&attendees_json),
                tags: parse_json_vec(&tags_json),
                people: parse_json_vec(&people_json),
                summary: row.get::<_, Option<String>>(10)?,
                action_items: parse_json_vec(&action_items_json),
                decisions: parse_json_vec(&decisions_json),
                calendar_event_id: row.get::<_, Option<String>>(13)?,
                whisper_model: row.get::<_, Option<String>>(14)?,
            })
        })
        .map_err(|e| format!("Failed to query legacy meetings: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("Failed to read legacy meeting row: {e}"))?);
    }
    Ok(out)
}

/// Parse a JSON string array column into a Vec<String>; empty/invalid → empty vec.
fn parse_json_vec(s: &str) -> Vec<String> {
    if s.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str(s).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_timestamped_transcript() {
        let md = "# Title — date\n\n**Duration:** 1m\n\n---\n\n[00:00:05] hello there\n[00:00:09] second line\ncontinued\n";
        let segs = parse_transcript_md(md);
        assert_eq!(segs.len(), 2);
        assert_eq!(segs[0].start, 5.0);
        assert_eq!(segs[0].end, 9.0);
        assert_eq!(segs[0].text, "hello there");
        assert_eq!(segs[1].text, "second line continued");
    }

    #[test]
    fn to_iso_combines_date_and_time() {
        assert_eq!(to_iso("2026-03-05", "09:30"), "2026-03-05T09:30:00Z");
        assert_eq!(to_iso("2026-03-05", ""), "2026-03-05T00:00:00Z");
    }

    #[test]
    fn folder_prefers_tag_then_year() {
        let mut m = OldMeeting {
            title: "x".into(),
            date: "2026-03-05".into(),
            start_time: "09:00".into(),
            duration_seconds: 0,
            audio_path: String::new(),
            transcript_path: None,
            folder_path: String::new(),
            attendees: vec![],
            tags: vec![],
            people: vec![],
            summary: None,
            action_items: vec![],
            decisions: vec![],
            calendar_event_id: None,
            whisper_model: None,
        };
        assert_eq!(pick_folder(&m), "Imported/2026");
        m.tags = vec!["Work".into()];
        assert_eq!(pick_folder(&m), "Imported/Work");
    }
}
