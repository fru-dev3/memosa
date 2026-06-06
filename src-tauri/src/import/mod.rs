use crate::storage::{db::Database, fs as storage_fs};
use crate::types::{Meeting, MeetingFilter, TranscriptionStatus};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VoiceMemoEntry {
    pub id: String,
    pub title: String,
    pub path: String,
    pub date: String,
    pub start_time: String,
    pub duration_seconds: u64,
    pub size_bytes: u64,
    pub already_imported: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImportRequest {
    pub title: String,
    pub path: String,
    pub date: String,
    pub start_time: String,
    pub duration_seconds: u64,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Open a folder picker and return the selected path.
#[tauri::command]
pub async fn pick_import_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let builder = app_handle
        .dialog()
        .file()
        .set_title("Select folder containing voice memos");

    let selected = builder.blocking_pick_folder();
    let Some(file_path) = selected else {
        return Ok(None);
    };

    let folder = file_path
        .into_path()
        .map_err(|e| format!("Failed to resolve folder: {}", e))?;

    Ok(Some(folder.to_string_lossy().into_owned()))
}

/// Scan a folder (recursively up to depth 5) for audio files.
/// Returns metadata for each, including whether it's already been imported.
#[tauri::command]
pub async fn scan_voice_memos(
    folder_path: String,
    db: State<'_, Database>,
) -> Result<Vec<VoiceMemoEntry>, String> {
    let root = Path::new(&folder_path);
    if !root.exists() {
        return Err(format!("Folder not found: {}", folder_path));
    }

    // Build set of already-imported source paths
    let existing = db
        .get_meetings(&MeetingFilter {
            from_date: None,
            to_date: None,
            transcription_status: None,
            profile_id: None,
        })
        .unwrap_or_default();

    let imported_paths: std::collections::HashSet<String> = existing
        .iter()
        .filter_map(|m| m.source_app.as_deref())
        .filter(|s| s.starts_with("imported:"))
        .map(|s| s[9..].to_string())
        .collect();

    let mut entries: Vec<VoiceMemoEntry> = Vec::new();
    scan_recursive(root, &imported_paths, &mut entries, 0);

    // Sort newest first
    entries.sort_by(|a, b| {
        format!("{}{}", b.date, b.start_time)
            .cmp(&format!("{}{}", a.date, a.start_time))
    });

    Ok(entries)
}

/// Import selected voice memo entries into Memosa storage.
#[tauri::command]
pub async fn import_voice_memos(
    entries: Vec<ImportRequest>,
    app_handle: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<Vec<Meeting>, String> {
    let settings = crate::storage::SettingsManager::load();
    let storage_root = std::path::PathBuf::from(&settings.storage_path);
    let mut imported: Vec<Meeting> = Vec::new();
    let total = entries.len();

    for (i, entry) in entries.iter().enumerate() {
        match import_single(entry, &storage_root, &db) {
            Ok(meeting) => {
                let _ = app_handle.emit(
                    "import-progress",
                    serde_json::json!({
                        "current": i + 1,
                        "total": total,
                        "title": meeting.title,
                    }),
                );
                let _ = app_handle.emit(
                    "meeting-saved",
                    serde_json::json!({ "meeting": meeting }),
                );
                imported.push(meeting);
            }
            Err(e) => {
                crate::diagnostics::log(&format!(
                    "import: skipping '{}': {}",
                    entry.title, e
                ));
            }
        }
    }

    Ok(imported)
}

// ── Internals ─────────────────────────────────────────────────────────────────

fn scan_recursive(
    dir: &Path,
    imported_paths: &std::collections::HashSet<String>,
    entries: &mut Vec<VoiceMemoEntry>,
    depth: usize,
) {
    if depth > 5 {
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_recursive(&path, imported_paths, entries, depth + 1);
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !matches!(ext.as_str(), "m4a" | "wav" | "mp3" | "aac" | "caf") {
            continue;
        }

        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };

        let path_str = path.to_string_lossy().to_string();
        let size_bytes = meta.len();
        let (date, start_time) = datetime_from_metadata(&meta);
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Voice Memo");
        let title = humanize_stem(stem);
        let duration_seconds = probe_duration(&path).unwrap_or(0);
        let already_imported = imported_paths.contains(&path_str);

        entries.push(VoiceMemoEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title,
            path: path_str,
            date,
            start_time,
            duration_seconds,
            size_bytes,
            already_imported,
        });
    }
}

fn import_single(
    entry: &ImportRequest,
    storage_root: &std::path::PathBuf,
    db: &Database,
) -> Result<Meeting, String> {
    let src = Path::new(&entry.path);
    if !src.exists() {
        return Err(format!("File not found: {}", entry.path));
    }

    let dt = parse_local_datetime(&entry.date, &entry.start_time);
    let folder = storage_fs::create_meeting_folder(storage_root, &entry.title, &dt)?;

    // Preserve original extension
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("m4a");
    let audio_dest = folder.join(format!("audio.{}", ext));

    std::fs::copy(src, &audio_dest)
        .map_err(|e| format!("Failed to copy audio: {}", e))?;

    let meeting = Meeting {
        id: uuid::Uuid::new_v4().to_string(),
        title: entry.title.clone(),
        date: entry.date.clone(),
        start_time: entry.start_time.clone(),
        duration_seconds: entry.duration_seconds,
        audio_path: audio_dest.to_string_lossy().to_string(),
        transcript_path: None,
        transcription_status: TranscriptionStatus::NotStarted,
        calendar_event_id: None,
        attendees: Vec::new(),
        whisper_model: None,
        profile_id: None,
        // Encode the original path so we can detect duplicates on re-import
        source_app: Some(format!("imported:{}", entry.path)),
        summary: None,
        tags: Vec::new(),
        people: Vec::new(),
        themes: Vec::new(),
        keywords: Vec::new(),
        is_favorite: false,
        action_items: Vec::new(),
        decisions: Vec::new(),
    };

    storage_fs::write_metadata(&folder, &meeting)?;
    db.insert_meeting(&meeting, &folder.to_string_lossy())?;

    Ok(meeting)
}

fn datetime_from_metadata(
    meta: &std::fs::Metadata,
) -> (String, String) {
    use chrono::TimeZone;
    use std::time::UNIX_EPOCH;

    let system_time = meta
        .modified()
        .or_else(|_| meta.created())
        .unwrap_or(std::time::SystemTime::now());

    let secs = system_time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let dt = chrono::Local
        .timestamp_opt(secs, 0)
        .single()
        .unwrap_or_else(chrono::Local::now);

    (
        dt.format("%Y-%m-%d").to_string(),
        dt.format("%H:%M").to_string(),
    )
}

fn parse_local_datetime(date: &str, time: &str) -> chrono::DateTime<chrono::Local> {
    use chrono::TimeZone;
    let s = format!("{} {}", date, time);
    chrono::Local
        .datetime_from_str(&s, "%Y-%m-%d %H:%M")
        .unwrap_or_else(|_| chrono::Local::now())
}

fn humanize_stem(stem: &str) -> String {
    // Looks like a UUID — use generic title
    if stem.len() == 36 && stem.chars().filter(|&c| c == '-').count() == 4 {
        return "Voice Memo".to_string();
    }
    // Replace separators with spaces, collapse multiples
    let raw = stem.replace(['-', '_', '.'], " ");
    let mut result = String::new();
    let mut last_space = true;
    for c in raw.chars() {
        if c == ' ' {
            if !last_space {
                result.push(' ');
            }
            last_space = true;
        } else {
            result.push(c);
            last_space = false;
        }
    }
    result.trim().to_string()
}

/// Read actual audio duration from file metadata using symphonia.
/// Falls back to a file-size estimate if symphonia cannot parse the file.
fn probe_duration(path: &Path) -> Option<u64> {
    if let Some(dur) = probe_duration_symphonia(path) {
        return Some(dur);
    }
    probe_duration_estimate(path)
}

/// Use symphonia to read the true duration from audio metadata / headers.
fn probe_duration_symphonia(path: &Path) -> Option<u64> {
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &Default::default(), &Default::default())
        .ok()?;
    let track = probed.format.default_track()?;
    let tb = track.codec_params.time_base?;
    let dur = track.codec_params.n_frames?;
    Some((tb.numer as u64 * dur) / tb.denom as u64)
}

/// Fallback: estimate duration from file size using average bitrates per format.
fn probe_duration_estimate(path: &Path) -> Option<u64> {
    let size = std::fs::metadata(path).ok()?.len();
    if size == 0 {
        return None;
    }
    let ext = path.extension()?.to_str()?.to_lowercase();
    // Average bytes per second for common formats
    let bytes_per_sec: u64 = match ext.as_str() {
        "m4a" | "aac" => 16_000,  // ~128 kbps
        "mp3" => 16_000,          // ~128 kbps
        "wav" => 176_400,         // 44.1kHz 16-bit stereo
        "ogg" | "opus" => 12_000, // ~96 kbps
        "flac" => 88_200,         // ~706 kbps (lossless)
        _ => 16_000,              // fallback
    };
    Some(size / bytes_per_sec)
}
