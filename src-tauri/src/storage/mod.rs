pub mod db;
pub mod fs;
pub mod settings;

pub use db::Database;
pub use settings::SettingsManager;

use crate::types::{
    AppSettings, AudioFileStatus, CleanupAction, CleanupCandidate, CleanupLogEntry, CleanupPreview,
    CleanupRunResult, Meeting, MeetingFilter, StorageUsage, TranscriptionStatus,
};
use std::path::PathBuf;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

pub fn create_meeting_record_with_id(
    meeting_id: String,
    title: &str,
    calendar_event_id: Option<&str>,
    attendees: Vec<String>,
    profile_id: Option<String>,
    source_app: Option<String>,
    settings: &AppSettings,
    db: &Database,
) -> Result<(Meeting, PathBuf), String> {
    let now = chrono::Local::now();
    let folder =
        fs::create_meeting_folder(std::path::Path::new(&settings.storage_path), title, &now)?;

    let meeting = Meeting {
        id: meeting_id,
        title: title.to_string(),
        date: now.format("%Y-%m-%d").to_string(),
        start_time: now.format("%H:%M").to_string(),
        duration_seconds: 0,
        audio_path: folder.join("audio.m4a").to_string_lossy().to_string(),
        transcript_path: None,
        transcription_status: TranscriptionStatus::NotStarted,
        calendar_event_id: calendar_event_id.map(String::from),
        attendees,
        whisper_model: None,
        profile_id,
        source_app,
        summary: None,
        tags: Vec::new(),
        people: Vec::new(),
        themes: Vec::new(),
        keywords: Vec::new(),
        is_favorite: false,
    };

    fs::write_metadata(&folder, &meeting)?;
    db.insert_meeting(&meeting, &folder.to_string_lossy())?;

    Ok((meeting, folder))
}

/// Create a new meeting record: generate UUID, create folder, write metadata.json, insert into DB.
/// Returns (meeting_id, folder_path).
/// Called by the audio recorder (Agent 1) when a recording starts.
#[allow(dead_code)]
pub fn create_meeting_record(
    title: &str,
    calendar_event_id: Option<&str>,
    attendees: Vec<String>,
    profile_id: Option<String>,
    settings: &AppSettings,
    db: &Database,
) -> Result<(String, PathBuf), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (meeting, folder) =
        create_meeting_record_with_id(id, title, calendar_event_id, attendees, profile_id, None, settings, db)?;

    Ok((meeting.id.clone(), folder))
}

/// Index a completed transcript into the FTS5 table for full-text search.
/// Reads transcript.md from the meeting folder, strips markdown, then inserts into FTS.
/// Called by the transcription agent (Agent 2) after transcription completes.
pub fn index_transcript(meeting_id: &str, db: &Database) -> Result<(), String> {
    let meeting = db
        .get_meeting(meeting_id)?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    let transcript_path = meeting
        .transcript_path
        .as_ref()
        .ok_or_else(|| "Meeting has no transcript path".to_string())?;

    let raw = std::fs::read_to_string(transcript_path)
        .map_err(|e| format!("Failed to read transcript: {}", e))?;

    // Strip markdown: remove heading markers, bold/italic markers, timestamp brackets, hrules
    let plain = strip_markdown(&raw);

    db.index_transcript(meeting_id, &meeting.title, &plain)
}

/// Strip basic markdown formatting for plain-text FTS indexing.
fn strip_markdown(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.lines() {
        // Skip horizontal rules
        if line.trim_start_matches('-').trim().is_empty() && line.contains("---") {
            result.push('\n');
            continue;
        }
        // Strip heading markers (#)
        let line = line.trim_start_matches('#').trim();
        // Strip bold/italic (**text** or *text*)
        let line = line.replace("**", "").replace('*', "");
        // Strip timestamp brackets like [00:01:23]
        let line = strip_timestamp_brackets(&line);
        result.push_str(&line);
        result.push('\n');
    }
    result
}

fn strip_timestamp_brackets(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            // Peek ahead: if it looks like [HH:MM:SS], skip it
            let mut buf = String::new();
            let mut closed = false;
            for ch in chars.by_ref() {
                if ch == ']' {
                    closed = true;
                    break;
                }
                buf.push(ch);
            }
            // Only strip if it looked like a timestamp (digits and colons only)
            if closed && buf.chars().all(|c| c.is_ascii_digit() || c == ':') {
                out.push(' ');
            } else {
                // Not a timestamp — put it back
                out.push('[');
                out.push_str(&buf);
                if closed {
                    out.push(']');
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

use crate::types::SearchResult;
use tauri::Emitter;

#[tauri::command]
pub async fn get_meetings(
    filter: MeetingFilter,
    db: tauri::State<'_, Database>,
) -> Result<Vec<Meeting>, String> {
    db.get_meetings(&filter)
}

#[tauri::command]
pub async fn get_meeting(id: String, db: tauri::State<'_, Database>) -> Result<Meeting, String> {
    db.get_meeting(&id)?
        .ok_or_else(|| "Meeting not found".to_string())
}

#[tauri::command]
pub async fn search_meetings(
    query: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<SearchResult>, String> {
    db.search_meetings(&query)
}

#[tauri::command]
pub async fn delete_meeting(
    id: String,
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if let Some(folder_path) = db.delete_meeting(&id)? {
        if std::path::Path::new(&folder_path).exists() {
            std::fs::remove_dir_all(&folder_path)
                .map_err(|e| format!("Failed to delete meeting folder: {}", e))?;
        }
    }
    app_handle
        .emit("meeting-deleted", serde_json::json!({ "id": id }))
        .ok();
    Ok(())
}

#[tauri::command]
pub async fn get_storage_path() -> Result<String, String> {
    Ok(SettingsManager::load().storage_path)
}

#[tauri::command]
pub async fn set_storage_path(path: String) -> Result<(), String> {
    let mut settings = SettingsManager::load();
    settings.storage_path = path;
    SettingsManager::save(&settings)
}

#[tauri::command]
pub async fn get_settings(app_handle: tauri::AppHandle) -> Result<AppSettings, String> {
    crate::diagnostics::log("cmd:get_settings begin");
    let mut settings = SettingsManager::load();
    crate::diagnostics::log("cmd:get_settings loaded settings");
    settings.launch_at_login = app_handle
        .autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to read launch-at-login state: {}", e))?;
    crate::diagnostics::log(format!(
        "cmd:get_settings autolaunch={}",
        settings.launch_at_login
    ));
    Ok(settings)
}

#[tauri::command]
pub async fn save_settings(
    settings: AppSettings,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let autolaunch = app_handle.autolaunch();
    let currently_enabled = autolaunch
        .is_enabled()
        .map_err(|e| format!("Failed to read launch-at-login state: {}", e))?;

    if settings.launch_at_login && !currently_enabled {
        autolaunch
            .enable()
            .map_err(|e| format!("Failed to enable launch at login: {}", e))?;
    } else if !settings.launch_at_login && currently_enabled {
        autolaunch
            .disable()
            .map_err(|e| format!("Failed to disable launch at login: {}", e))?;
    }

    SettingsManager::save(&settings)
}

#[tauri::command]
pub async fn open_meeting_folder(id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    let folder = db
        .get_folder_path(&id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    fs::open_in_finder(std::path::Path::new(&folder))
}

#[tauri::command]
pub async fn read_meeting_transcript(
    id: String,
    db: tauri::State<'_, Database>,
) -> Result<String, String> {
    let meeting = db
        .get_meeting(&id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(&id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;

    let fallback_path = std::path::Path::new(&folder).join("transcript.md");
    let transcript_path = meeting
        .transcript_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|path| path.exists())
        .unwrap_or(fallback_path);

    std::fs::read_to_string(&transcript_path).map_err(|e| {
        format!(
            "Failed to read transcript from {}: {}",
            transcript_path.display(),
            e
        )
    })
}

/// Find the notes file for a meeting. Prefers the timestamped format
/// (`notes-YYYY-MM-DD.md`) but falls back to the legacy `notes.md`.
fn resolve_notes_path(folder: &str, meeting_date: &str) -> std::path::PathBuf {
    let dir = std::path::Path::new(folder);
    // Date portion only (YYYY-MM-DD)
    let date_part = &meeting_date[..10.min(meeting_date.len())];
    let timestamped = dir.join(format!("notes-{}.md", date_part));
    if timestamped.exists() {
        return timestamped;
    }
    let legacy = dir.join("notes.md");
    if legacy.exists() {
        return legacy;
    }
    // New file → use timestamped name
    timestamped
}

#[tauri::command]
pub async fn read_meeting_notes(
    id: String,
    db: tauri::State<'_, Database>,
) -> Result<String, String> {
    let folder = db
        .get_folder_path(&id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;
    let meeting = db.get_meeting(&id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let notes_path = resolve_notes_path(&folder, &meeting.date);
    if !notes_path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&notes_path).map_err(|e| {
        format!(
            "Failed to read notes from {}: {}",
            notes_path.display(),
            e
        )
    })
}

#[tauri::command]
pub async fn save_meeting_notes(
    id: String,
    content: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    let folder = db
        .get_folder_path(&id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;
    let meeting = db.get_meeting(&id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let notes_path = resolve_notes_path(&folder, &meeting.date);

    if content.trim().is_empty() {
        // Clean up both legacy and timestamped if they exist
        let dir = std::path::Path::new(&folder);
        let legacy = dir.join("notes.md");
        if notes_path.exists() {
            std::fs::remove_file(&notes_path)
                .map_err(|e| format!("Failed to clear meeting notes: {}", e))?;
        }
        if legacy.exists() && legacy != notes_path {
            let _ = std::fs::remove_file(&legacy);
        }
        return Ok(());
    }

    std::fs::write(&notes_path, &content)
        .map_err(|e| format!("Failed to save meeting notes: {}", e))?;

    // Migrate: if we wrote to timestamped and legacy still exists, remove legacy
    let legacy = std::path::Path::new(&folder).join("notes.md");
    if legacy.exists() && legacy != notes_path {
        let _ = std::fs::remove_file(&legacy);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_meeting_audio_status(
    id: String,
    db: tauri::State<'_, Database>,
) -> Result<AudioFileStatus, String> {
    let meeting = db
        .get_meeting(&id)?
        .ok_or_else(|| "Meeting not found".to_string())?;

    let audio_path = std::path::PathBuf::from(&meeting.audio_path);
    let metadata = std::fs::metadata(&audio_path).ok();
    let exists = metadata.is_some();
    let bytes = metadata.map(|entry| entry.len()).unwrap_or(0);
    let (is_silent, peak_db) = if exists && bytes > 0 {
        inspect_audio_signal(&audio_path).unwrap_or((false, None))
    } else {
        (false, None)
    };

    Ok(AudioFileStatus {
        path: meeting.audio_path,
        exists,
        bytes,
        is_empty: exists && bytes == 0,
        is_silent,
        peak_db,
    })
}

fn inspect_audio_signal(path: &std::path::Path) -> Result<(bool, Option<f32>), String> {
    #[cfg(target_os = "macos")]
    {
        let peak_db = crate::macos::get_audio_peak_db(path);
        let is_silent = peak_db.map(|db| db <= -70.0).unwrap_or(false);
        Ok((is_silent, peak_db))
    }
    #[cfg(not(target_os = "macos"))]
    Ok((false, None))
}

fn parse_meeting_date_days_ago(meeting: &Meeting) -> Option<i64> {
    let date = chrono::NaiveDate::parse_from_str(&meeting.date, "%Y-%m-%d").ok()?;
    Some((chrono::Local::now().date_naive() - date).num_days())
}

fn file_size(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
}

fn folder_size(path: &std::path::Path) -> u64 {
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    let mut total = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            total += folder_size(&path);
        } else {
            total += file_size(&path);
        }
    }
    total
}

fn build_storage_usage(storage_root: &std::path::Path, meetings: &[Meeting]) -> StorageUsage {
    let archive_root = storage_root.join("Archive");
    let archive_bytes = if archive_root.exists() {
        folder_size(&archive_root)
    } else {
        0
    };

    let audio_bytes = meetings
        .iter()
        .map(|meeting| file_size(std::path::Path::new(&meeting.audio_path)))
        .sum();
    let transcript_bytes = meetings
        .iter()
        .filter_map(|meeting| meeting.transcript_path.as_ref())
        .map(|path| file_size(std::path::Path::new(path)))
        .sum();
    let metadata_bytes = meetings
        .iter()
        .filter_map(|meeting| meeting_audio_folder(meeting))
        .map(|folder| file_size(&folder.join("metadata.json")))
        .sum();

    let total_bytes = if storage_root.exists() {
        folder_size(storage_root)
    } else {
        0
    };

    let other_bytes = total_bytes
        .saturating_sub(audio_bytes)
        .saturating_sub(transcript_bytes)
        .saturating_sub(metadata_bytes)
        .saturating_sub(archive_bytes);

    StorageUsage {
        total_bytes,
        archive_bytes,
        audio_bytes,
        transcript_bytes,
        metadata_bytes,
        other_bytes,
        meeting_count: meetings.len() as u64,
        archive_count: if archive_root.exists() {
            fs::scan_all_meetings(&archive_root).len() as u64
        } else {
            0
        },
    }
}

fn meeting_audio_folder(meeting: &Meeting) -> Option<std::path::PathBuf> {
    std::path::Path::new(&meeting.audio_path)
        .parent()
        .map(|parent| parent.to_path_buf())
}

fn build_cleanup_preview(settings: &AppSettings, meetings: &[Meeting]) -> CleanupPreview {
    if !settings.retention_policy.enabled {
        return CleanupPreview {
            candidates: Vec::new(),
            total_bytes_reclaimable: 0,
            protected_count: 0,
        };
    }

    let mut candidates = Vec::new();
    let mut protected_count = 0;

    for meeting in meetings {
        let Some(days_old) = parse_meeting_date_days_ago(meeting) else {
            continue;
        };

        if settings.retention_policy.keep_starred && meeting.is_favorite {
            protected_count += 1;
            continue;
        }

        if meeting
            .profile_id
            .as_ref()
            .is_some_and(|profile| settings.retention_policy.keep_profiles.contains(profile))
        {
            protected_count += 1;
            continue;
        }

        let folder = meeting_audio_folder(meeting);
        let folder_path = folder.as_deref();
        let folder_bytes = folder_path.map(folder_size).unwrap_or(0);
        let transcript_path = meeting.transcript_path.as_deref().map(std::path::Path::new);
        let transcript_bytes = transcript_path.map(file_size).unwrap_or(0);

        let folder_is_archived = folder_path
            .map(|path| path.components().any(|component| component.as_os_str() == "Archive"))
            .unwrap_or(false);

        if days_old >= settings.retention_policy.recordings_delete_after_days as i64 {
            candidates.push(CleanupCandidate {
                meeting_id: meeting.id.clone(),
                title: meeting.title.clone(),
                date: meeting.date.clone(),
                action: CleanupAction::DeleteMeeting,
                reason: format!(
                    "Older than {} days",
                    settings.retention_policy.recordings_delete_after_days
                ),
                bytes_reclaimable: folder_bytes,
                profile_id: meeting.profile_id.clone(),
            });
            continue;
        }

        if !folder_is_archived && days_old >= settings.retention_policy.archive_after_days as i64 {
            candidates.push(CleanupCandidate {
                meeting_id: meeting.id.clone(),
                title: meeting.title.clone(),
                date: meeting.date.clone(),
                action: CleanupAction::ArchiveMeeting,
                reason: format!(
                    "Older than {} days and ready to archive",
                    settings.retention_policy.archive_after_days
                ),
                bytes_reclaimable: folder_bytes,
                profile_id: meeting.profile_id.clone(),
            });
            continue;
        }

        if transcript_bytes > 0
            && days_old >= settings.retention_policy.transcripts_delete_after_days as i64
        {
            candidates.push(CleanupCandidate {
                meeting_id: meeting.id.clone(),
                title: meeting.title.clone(),
                date: meeting.date.clone(),
                action: CleanupAction::DeleteTranscript,
                reason: format!(
                    "Transcript older than {} days",
                    settings.retention_policy.transcripts_delete_after_days
                ),
                bytes_reclaimable: transcript_bytes,
                profile_id: meeting.profile_id.clone(),
            });
        }
    }

    let total_bytes_reclaimable = candidates.iter().map(|candidate| candidate.bytes_reclaimable).sum();
    CleanupPreview {
        candidates,
        total_bytes_reclaimable,
        protected_count,
    }
}

fn archive_meeting_folder(
    meeting: &Meeting,
    db: &Database,
    storage_root: &std::path::Path,
) -> Result<u64, String> {
    let current_folder = meeting_audio_folder(meeting).ok_or_else(|| "Meeting folder missing".to_string())?;
    if !current_folder.exists() {
        return Err("Meeting folder does not exist".to_string());
    }

    let folder_name = current_folder
        .file_name()
        .ok_or_else(|| "Meeting folder name missing".to_string())?;
    let archive_target = storage_root.join("Archive").join(folder_name);
    if let Some(parent) = archive_target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create archive folder: {}", e))?;
    }

    let reclaimed = folder_size(&current_folder);
    std::fs::rename(&current_folder, &archive_target)
        .map_err(|e| format!("Failed to archive meeting folder: {}", e))?;

    let audio_file_name = std::path::Path::new(&meeting.audio_path)
        .file_name()
        .ok_or_else(|| "Audio file name missing".to_string())?;
    let new_audio_path = archive_target.join(audio_file_name);
    let new_transcript_path = meeting.transcript_path.as_ref().and_then(|path| {
        std::path::Path::new(path)
            .file_name()
            .map(|file_name| archive_target.join(file_name).to_string_lossy().into_owned())
    });

    db.update_meeting_paths(
        &meeting.id,
        &archive_target.to_string_lossy(),
        &new_audio_path.to_string_lossy(),
        new_transcript_path.as_deref(),
    )?;

    fs::update_metadata(&archive_target, |stored| {
        stored.audio_path = new_audio_path.to_string_lossy().into_owned();
        stored.transcript_path = new_transcript_path.clone();
    })?;

    Ok(reclaimed)
}

fn delete_meeting_transcript_file(meeting: &Meeting, db: &Database) -> Result<u64, String> {
    let transcript_path = meeting
        .transcript_path
        .as_ref()
        .ok_or_else(|| "Meeting transcript is missing".to_string())?;
    let path = std::path::Path::new(transcript_path);
    let bytes = file_size(path);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to delete transcript: {}", e))?;
    }
    if let Some(folder) = meeting_audio_folder(meeting) {
        fs::update_metadata(&folder, |stored| {
            stored.transcript_path = None;
            stored.transcription_status = TranscriptionStatus::NotStarted;
        })?;
    }
    db.update_transcription_state(&meeting.id, "not_started", None, None)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn get_storage_usage(db: tauri::State<'_, Database>) -> Result<StorageUsage, String> {
    let settings = SettingsManager::load();
    let meetings = db.get_meetings(&MeetingFilter {
        from_date: None,
        to_date: None,
        transcription_status: None,
        profile_id: None,
    })?;
    Ok(build_storage_usage(
        std::path::Path::new(&settings.storage_path),
        &meetings,
    ))
}

#[tauri::command]
pub async fn preview_cleanup(db: tauri::State<'_, Database>) -> Result<CleanupPreview, String> {
    let settings = SettingsManager::load();
    let meetings = db.get_meetings(&MeetingFilter {
        from_date: None,
        to_date: None,
        transcription_status: None,
        profile_id: None,
    })?;
    Ok(build_cleanup_preview(&settings, &meetings))
}

/// Internal cleanup runner used by both the Tauri command and the scheduled background task.
pub async fn run_scheduled_cleanup(
    db: &Database,
    app_handle: &tauri::AppHandle,
) -> Result<CleanupRunResult, String> {
    run_cleanup_impl(db, app_handle).await
}

async fn run_cleanup_impl(
    db: &Database,
    app_handle: &tauri::AppHandle,
) -> Result<CleanupRunResult, String> {
    let settings = SettingsManager::load();
    let meetings = db.get_meetings(&MeetingFilter {
        from_date: None,
        to_date: None,
        transcription_status: None,
        profile_id: None,
    })?;
    let preview = build_cleanup_preview(&settings, &meetings);
    let mut result = CleanupRunResult {
        archived: 0,
        transcripts_deleted: 0,
        meetings_deleted: 0,
        reclaimed_bytes: 0,
        failed: Vec::new(),
    };

    for candidate in preview.candidates {
        let meeting = match db.get_meeting(&candidate.meeting_id)? {
            Some(meeting) => meeting,
            None => continue,
        };
        let operation = match candidate.action {
            CleanupAction::ArchiveMeeting => archive_meeting_folder(
                &meeting,
                db,
                std::path::Path::new(&settings.storage_path),
            )
            .map(|bytes| {
                result.archived += 1;
                bytes
            }),
            CleanupAction::DeleteTranscript => delete_meeting_transcript_file(&meeting, db).map(|bytes| {
                result.transcripts_deleted += 1;
                bytes
            }),
            CleanupAction::DeleteMeeting => {
                let bytes = meeting_audio_folder(&meeting)
                    .as_deref()
                    .map(folder_size)
                    .unwrap_or(0);
                if let Some(folder_path) = db.delete_meeting(&candidate.meeting_id)? {
                    if std::path::Path::new(&folder_path).exists() {
                        let _ = std::fs::remove_dir_all(&folder_path);
                    }
                }
                app_handle
                    .emit("meeting-deleted", serde_json::json!({ "id": candidate.meeting_id }))
                    .ok();
                result.meetings_deleted += 1;
                Ok(bytes)
            }
        };

        match operation {
            Ok(bytes) => result.reclaimed_bytes += bytes,
            Err(error) => result.failed.push(format!("{}: {}", candidate.title, error)),
        }
    }

    append_cleanup_log(&result);
    Ok(result)
}

#[tauri::command]
pub async fn run_cleanup_now(
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<CleanupRunResult, String> {
    run_cleanup_impl(db.inner(), &app_handle).await
}

fn cleanup_log_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("cleanup_log.json")
}

fn append_cleanup_log(result: &CleanupRunResult) {
    let path = cleanup_log_path();
    let mut entries: Vec<CleanupLogEntry> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    entries.push(CleanupLogEntry {
        timestamp: chrono::Utc::now().to_rfc3339(),
        archived: result.archived,
        meetings_deleted: result.meetings_deleted,
        transcripts_deleted: result.transcripts_deleted,
        reclaimed_bytes: result.reclaimed_bytes,
        failed: result.failed.clone(),
    });

    // Keep last 100 entries
    if entries.len() > 100 {
        entries.drain(0..entries.len() - 100);
    }

    if let Ok(json) = serde_json::to_string_pretty(&entries) {
        let _ = std::fs::write(&path, json);
    }
}

#[tauri::command]
pub async fn get_cleanup_log() -> Result<Vec<CleanupLogEntry>, String> {
    let path = cleanup_log_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read cleanup log: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse cleanup log: {}", e))
}

#[tauri::command]
pub async fn set_meeting_favorite(
    id: String,
    is_favorite: bool,
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    db.set_meeting_favorite(&id, is_favorite)?;
    if let Some(updated) = db.get_meeting(&id)? {
        app_handle
            .emit("meeting-updated", serde_json::json!({ "meeting": updated }))
            .ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn save_meeting_transcript(
    id: String,
    content: String,
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let meeting = db
        .get_meeting(&id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(&id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;

    let transcript_path = std::path::Path::new(&folder).join("transcript.md");
    std::fs::write(&transcript_path, &content)
        .map_err(|e| format!("Failed to write transcript: {}", e))?;

    fs::update_metadata(std::path::Path::new(&folder), |stored| {
        stored.transcript_path = Some(transcript_path.to_string_lossy().into_owned());
        stored.transcription_status = TranscriptionStatus::Complete;
    })?;

    db.update_transcription_state(
        &id,
        "complete",
        Some(transcript_path.to_string_lossy().as_ref()),
        meeting.whisper_model.as_ref(),
    )?;
    index_transcript(&id, &db)?;

    if let Some(updated_meeting) = db.get_meeting(&id)? {
        let insights =
            crate::transcription::jobs::build_meeting_insights(&updated_meeting, &content, None, None);
        db.update_meeting_insights(
            &id,
            &insights.brief_summary,
            &insights.tags,
            &insights.people,
            &insights.themes,
            &insights.keywords,
        )?;
        fs::update_metadata(std::path::Path::new(&folder), |stored| {
            stored.summary = Some(insights.brief_summary.clone());
            stored.tags = insights.tags.clone();
            stored.people = insights.people.clone();
            stored.themes = insights.themes.clone();
            stored.keywords = insights.keywords.clone();
        })?;
    }

    if let Some(updated) = db.get_meeting(&id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": updated }))
            .ok();
    }

    Ok(())
}


#[tauri::command]
pub async fn pick_storage_folder(
    app_handle: tauri::AppHandle,
    current_path: Option<String>,
) -> Result<Option<String>, String> {
    let dialog = app_handle
        .dialog()
        .file()
        .set_title("Select Memosa storage folder");
    let dialog = if let Some(path) = current_path.filter(|path| !path.trim().is_empty()) {
        dialog.set_directory(path)
    } else {
        dialog
    };

    let selected = dialog.blocking_pick_folder();
    let Some(file_path) = selected else {
        return Ok(None);
    };

    let folder = file_path
        .into_path()
        .map_err(|e| format!("Failed to resolve selected folder: {}", e))?;

    Ok(Some(folder.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn rename_meeting(
    id: String,
    title: String,
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Title cannot be empty".to_string());
    }
    db.rename_meeting(&id, &title)?;
    if let Some(updated) = db.get_meeting(&id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": updated }))
            .ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn update_meeting_profile(
    id: String,
    profile_id: Option<String>,
    db: tauri::State<'_, Database>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let folder = db
        .get_folder_path(&id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;

    db.update_meeting_profile(&id, profile_id.as_deref())?;
    fs::update_metadata(std::path::Path::new(&folder), |stored| {
        stored.profile_id = profile_id.clone();
    })?;

    if let Some(updated) = db.get_meeting(&id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": updated }))
            .ok();
    }

    Ok(())
}

// ─── Profile persistence ──────────────────────────────────────────────────────

fn profiles_path() -> std::path::PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("profiles.json")
}

#[tauri::command]
pub async fn load_profiles() -> Result<serde_json::Value, String> {
    let path = profiles_path();
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read profiles: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse profiles: {}", e))
}

#[tauri::command]
pub async fn save_profiles(data: serde_json::Value) -> Result<(), String> {
    let path = profiles_path();
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("Failed to create .memosa dir: {}", e))?;
    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write profiles.json: {}", e))
}

#[tauri::command]
pub async fn save_text_file(
    filename: String,
    content: String,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri_plugin_dialog::DialogExt;

    let path = app_handle
        .dialog()
        .file()
        .set_title("Save transcript")
        .set_file_name(&filename)
        .blocking_save_file();

    let Some(file_path) = path else {
        return Ok(()); // user cancelled
    };

    let resolved = file_path
        .into_path()
        .map_err(|e| format!("Failed to resolve path: {}", e))?;

    std::fs::write(&resolved, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

// ─── Folder + assignment persistence commands ─────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize)]
pub struct FolderRecord {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: Option<String>,
}

#[tauri::command]
pub async fn get_folders(db: tauri::State<'_, Database>) -> Result<Vec<FolderRecord>, String> {
    let rows = db.get_all_folders()?;
    Ok(rows.into_iter().map(|(id, name, parent_id, color)| FolderRecord { id, name, parent_id, color }).collect())
}

#[tauri::command]
pub async fn save_folder(
    id: String,
    name: String,
    parent_id: Option<String>,
    color: Option<String>,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.upsert_folder(&id, &name, parent_id.as_deref(), color.as_deref())
}

#[tauri::command]
pub async fn delete_folder_record(id: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    db.delete_folder(&id)
}

#[tauri::command]
pub async fn save_all_folders(
    folders: Vec<FolderRecord>,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    for f in &folders {
        db.upsert_folder(&f.id, &f.name, f.parent_id.as_deref(), f.color.as_deref())?;
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct AssignmentRecord {
    pub meeting_id: String,
    pub folder_id: String,
}

#[tauri::command]
pub async fn get_folder_assignments(db: tauri::State<'_, Database>) -> Result<Vec<AssignmentRecord>, String> {
    let rows = db.get_all_assignments()?;
    Ok(rows.into_iter().map(|(meeting_id, folder_id)| AssignmentRecord { meeting_id, folder_id }).collect())
}

#[tauri::command]
pub async fn assign_meeting_folder(
    meeting_id: String,
    folder_id: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.assign_meeting_to_folder(&meeting_id, &folder_id)
}

#[tauri::command]
pub async fn remove_meeting_folder(
    meeting_id: String,
    folder_id: String,
    db: tauri::State<'_, Database>,
) -> Result<(), String> {
    db.remove_meeting_from_folder(&meeting_id, &folder_id)
}
