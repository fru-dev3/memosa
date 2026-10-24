//! Calendar auto-file into the files-only vault (spec 07).
//!
//! When a calendar meeting is auto-recorded, its conversation should land in a
//! sensible existing vault folder instead of a generic inbox. [`suggest_folder`]
//! scores every existing folder/domain in the vault tree against the event's
//! title keywords and attendee names, and returns the best match, or, when
//! nothing matches, a stable `Calendar/<year>` fallback.
//!
//! [`vault_calendar_autofile`] creates the conversation in that folder and stamps
//! its `meta.json` with the calendar provenance (`source = "calendar"`,
//! `calendar_event_id`, `people` = attendees, `created` = the event start), then
//! returns the new conversation id (`ConvId`). The audio/transcript are attached
//! later by the capture module's `finalize_to_vault`, which writes into this same id.

use crate::vault::{NodeKind, TreeNode, Vault};
use crate::vault_cmds::vault_root;

/// Words too generic to be useful folder-match signal.
const STOPWORDS: &[&str] = &[
    "the", "a", "an", "and", "or", "of", "to", "for", "with", "on", "in", "at",
    "by", "re", "meeting", "meet", "call", "sync", "syncup", "standup", "chat",
    "catch", "up", "weekly", "biweekly", "monthly", "daily", "quick", "1", "1on1",
    "one", "review", "checkin", "check", "intro", "follow", "followup",
];

/// Suggest a destination folder for a calendar event.
///
/// Matches title keywords and attendee tokens against the names of existing
/// folders/domains in `tree`. Returns the vault-relative path of the best
/// scoring folder, or `Calendar/<year>` (derived from `start_iso`) when nothing
/// scores above zero. The `Calendar/<year>` path is returned even if it does not
/// yet exist; the caller creates it.
pub fn suggest_folder(
    title: &str,
    attendees: &[String],
    tree: &TreeNode,
    start_iso: &str,
) -> String {
    let mut tokens = tokenize(title);
    for a in attendees {
        tokens.extend(attendee_tokens(a));
    }
    tokens.retain(|t| t.len() >= 3 && !STOPWORDS.contains(&t.as_str()));

    let mut folders: Vec<&TreeNode> = Vec::new();
    collect_folders(tree, &mut folders);

    let mut best: Option<(&TreeNode, usize)> = None;
    for folder in folders {
        let name_tokens = tokenize(folder.name.as_str());
        let mut score = 0usize;
        for nt in &name_tokens {
            if nt.len() < 3 || STOPWORDS.contains(&nt.as_str()) {
                continue;
            }
            for t in &tokens {
                if t == nt || t.contains(nt.as_str()) || nt.contains(t.as_str()) {
                    score += 1;
                    break;
                }
            }
        }
        if score == 0 {
            continue;
        }
        let better = match best {
            None => true,
            // Higher score wins; ties broken by deeper (more specific) path.
            Some((cur, cur_score)) => {
                score > cur_score
                    || (score == cur_score && depth(&folder.path) > depth(&cur.path))
            }
        };
        if better {
            best = Some((folder, score));
        }
    }

    match best {
        Some((folder, _)) => folder.path.clone(),
        None => format!("Calendar/{}", year_of(start_iso)),
    }
}

/// Tauri command: auto-file a calendar event into the vault.
///
/// Picks a folder via [`suggest_folder`], creates the conversation there, and
/// stamps calendar provenance onto its meta. Returns the new conversation id.
#[tauri::command]
pub fn vault_calendar_autofile(
    title: String,
    attendees: Vec<String>,
    start_iso: String,
    event_id: String,
) -> Result<String, String> {
    let v = Vault::new(vault_root());
    v.ensure().map_err(|e| e.to_string())?;

    let tree = v.tree().map_err(|e| e.to_string())?;
    let folder = suggest_folder(&title, &attendees, &tree, &start_iso);

    // Ensure the destination exists (covers the Calendar/<year> fallback and any
    // suggested domain folder that is currently empty on disk).
    v.create_folder(&folder).map_err(|e| e.to_string())?;

    let id = v
        .create_conversation(&folder, &title, &start_iso)
        .map_err(|e| e.to_string())?;

    let mut meta = v.read_meta(&id).map_err(|e| e.to_string())?;
    meta.source = "calendar".to_string();
    meta.calendar_event_id = Some(event_id);
    meta.people = attendees;
    meta.created = start_iso;
    v.write_meta(&meta).map_err(|e| e.to_string())?;

    Ok(id)
}

// ---- helpers ----

/// Depth-first collection of every domain/folder node (not conversations, not root).
fn collect_folders<'a>(node: &'a TreeNode, out: &mut Vec<&'a TreeNode>) {
    match node.kind {
        NodeKind::Conversation => {}
        NodeKind::Domain | NodeKind::Folder => {
            // Skip the synthetic root (empty path); include real folders/domains.
            if !node.path.is_empty() {
                out.push(node);
            }
            for child in &node.children {
                collect_folders(child, out);
            }
        }
    }
}

/// Lowercase alphanumeric tokens from arbitrary text.
fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

/// Tokens from an attendee identifier (email or display name). The email local
/// part ("jane.doe@acme.com" → "jane", "doe", "acme") tends to carry the useful
/// signal, so split it from the domain and tokenize both.
fn attendee_tokens(attendee: &str) -> Vec<String> {
    let mut out = Vec::new();
    match attendee.split_once('@') {
        Some((local, domain)) => {
            out.extend(tokenize(local));
            // Drop the public TLD-ish tail; keep the org label (e.g. "acme").
            let org = domain.split('.').next().unwrap_or(domain);
            out.extend(tokenize(org));
        }
        None => out.extend(tokenize(attendee)),
    }
    out
}

/// Number of path segments (specificity).
fn depth(path: &str) -> usize {
    path.split('/').filter(|s| !s.is_empty()).count()
}

/// Year from an ISO-8601 stamp; falls back to "unknown" if unparseable.
fn year_of(iso: &str) -> String {
    let y = iso.get(..4).unwrap_or("");
    if y.len() == 4 && y.chars().all(|c| c.is_ascii_digit()) {
        y.to_string()
    } else {
        chrono::Utc::now().format("%Y").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::TreeNode;

    fn folder(name: &str, path: &str, children: Vec<TreeNode>) -> TreeNode {
        TreeNode {
            kind: NodeKind::Folder,
            name: name.into(),
            path: path.into(),
            count: Some(0),
            children,
        }
    }

    fn root(children: Vec<TreeNode>) -> TreeNode {
        TreeNode {
            kind: NodeKind::Folder,
            name: "memosa".into(),
            path: String::new(),
            count: Some(0),
            children,
        }
    }

    #[test]
    fn matches_folder_by_title_keyword() {
        let tree = root(vec![
            folder("Work", "Work", vec![folder("Acme", "Work/Acme", vec![])]),
            folder("Life", "Life", vec![folder("Northwind", "Work/Northwind", vec![])]),
        ]);
        let got = suggest_folder(
            "Acme roadmap sync",
            &[],
            &tree,
            "2026-06-19T10:00:00Z",
        );
        assert_eq!(got, "Work/Acme");
    }

    #[test]
    fn matches_folder_by_attendee_org() {
        let tree = root(vec![folder("Acme", "Acme", vec![])]);
        let got = suggest_folder(
            "Weekly meeting",
            &["jane@acme.com".to_string()],
            &tree,
            "2026-06-19T10:00:00Z",
        );
        assert_eq!(got, "Acme");
    }

    #[test]
    fn falls_back_to_calendar_year() {
        let tree = root(vec![folder("Work", "Work", vec![])]);
        let got = suggest_folder(
            "Lunch with friend",
            &[],
            &tree,
            "2026-06-19T10:00:00Z",
        );
        assert_eq!(got, "Calendar/2026");
    }

    #[test]
    fn deeper_match_wins_ties() {
        let tree = root(vec![folder(
            "Acme",
            "Acme",
            vec![folder("Acme", "Acme/Acme", vec![])],
        )]);
        let got = suggest_folder("Acme", &[], &tree, "2026-06-19T10:00:00Z");
        assert_eq!(got, "Acme/Acme");
    }
}

// ---- 3.0 calendar: the Mac's calendars (EventKit) and auto-record (spec 07) ----

use serde::{Deserialize, Serialize};

/// Auto-record settings (spec 07). Off until the user turns it on.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AutoRecord {
    pub enabled: bool,
    pub ask_first: bool,
    pub min_attendees: usize,
    pub video_only: bool,
}

impl Default for AutoRecord {
    fn default() -> Self {
        AutoRecord { enabled: false, ask_first: true, min_attendees: 2, video_only: false }
    }
}

#[derive(Serialize)]
pub struct CalEvent {
    pub id: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub attendees: Vec<String>,
    pub video: bool,
    pub platform: Option<String>,
    /// Suggested vault folder for this meeting.
    pub folder: String,
    /// Whether the auto-record settings select this meeting.
    pub matches: bool,
}

#[derive(Deserialize)]
struct RawEvent {
    id: String,
    title: String,
    start: String,
    end: String,
    #[serde(default)]
    attendees: Vec<String>,
    #[serde(default)]
    location: String,
    #[serde(default)]
    description: String,
}

fn autorecord_file() -> std::path::PathBuf {
    crate::vault_cmds::config_dir().join("autorecord.json")
}

pub fn selects(cfg: &AutoRecord, attendees: usize, video: bool) -> bool {
    attendees >= cfg.min_attendees && (!cfg.video_only || video)
}

fn status_name(code: i32) -> &'static str {
    match code {
        0 => "not_asked",
        1 => "restricted",
        2 => "denied",
        3 => "granted",
        _ => "add_only",
    }
}

fn status_code() -> i32 {
    #[cfg(feature = "e2e")]
    if let Some(code) = crate::e2e::calendar_status_override() {
        return code;
    }
    crate::macos::calendar_status()
}

fn events_json(from: f64, to: f64) -> Option<String> {
    #[cfg(feature = "e2e")]
    if let Some(json) = crate::e2e::calendar_events_override() {
        return Some(json);
    }
    crate::macos::calendar_events_json(from, to)
}

/// Calendar permission: not_asked | denied | restricted | granted | add_only.
#[tauri::command]
pub fn calendar_access() -> String {
    status_name(status_code()).into()
}

/// Show the system calendar permission prompt (first time only) and return the result.
#[tauri::command]
pub async fn calendar_request_access() -> Result<String, String> {
    #[cfg(feature = "e2e")]
    if crate::e2e::calendar_status_override().is_some() {
        return Ok(calendar_access());
    }
    let code = tokio::task::spawn_blocking(crate::macos::calendar_request)
        .await
        .map_err(|e| e.to_string())?;
    Ok(status_name(code).into())
}

/// Meetings in the next `hours` (default 24) with a suggested folder each.
#[tauri::command]
pub fn calendar_upcoming(hours: Option<u32>) -> Result<Vec<CalEvent>, String> {
    if status_code() != 3 {
        return Ok(Vec::new());
    }
    let now = chrono::Utc::now();
    let from = (now - chrono::Duration::minutes(30)).timestamp() as f64;
    let to = (now + chrono::Duration::hours(hours.unwrap_or(24) as i64)).timestamp() as f64;
    let raw: Vec<RawEvent> = match events_json(from, to) {
        Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string())?,
        None => Vec::new(),
    };
    let cfg = autorecord_get();
    let tree = Vault::new(vault_root()).tree().map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|e| {
            let text = format!("{}\n{}\n{}", e.title, e.location, e.description);
            let platform = crate::calendar::providers::detect_platform(&text)
                .filter(|(p, _)| *p != "Phone")
                .map(|(p, _)| p.to_string());
            let folder = suggest_folder(&e.title, &e.attendees, &tree, &e.start);
            let video = platform.is_some();
            CalEvent {
                matches: selects(&cfg, e.attendees.len(), video),
                id: e.id,
                title: e.title,
                start: e.start,
                end: e.end,
                attendees: e.attendees,
                video,
                platform,
                folder,
            }
        })
        .collect())
}

#[tauri::command]
pub fn autorecord_get() -> AutoRecord {
    std::fs::read_to_string(autorecord_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn autorecord_set(cfg: AutoRecord) -> Result<AutoRecord, String> {
    std::fs::create_dir_all(crate::vault_cmds::config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(autorecord_file(), json).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[cfg(test)]
mod autorecord_tests {
    use super::*;

    #[test]
    fn selection_rules() {
        let cfg = AutoRecord { enabled: true, ask_first: true, min_attendees: 2, video_only: false };
        assert!(selects(&cfg, 2, false));
        assert!(!selects(&cfg, 1, true), "solo holds are skipped");
        let video = AutoRecord { video_only: true, ..cfg.clone() };
        assert!(!selects(&video, 3, false));
        assert!(selects(&video, 3, true));
        assert!(!AutoRecord::default().enabled, "off until the user turns it on");
    }
}
