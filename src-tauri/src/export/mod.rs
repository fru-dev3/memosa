pub mod providers;

use crate::storage::Database;
use crate::types::{
    ExportRequest, ExportResult, MarkdownExportMode, MarkdownExportRequest, MarkdownExportResult,
    Meeting, MeetingFilter,
};
use providers::local_stub::LocalStubProvider;
use providers::StorageProvider;
use std::collections::HashSet;
use std::path::PathBuf;

pub struct ExportContext {
    pub meeting: crate::types::Meeting,
    pub folder: PathBuf,
    pub transcript: Option<String>,
    pub output_dir: PathBuf,
}

fn build_export_context(request: &ExportRequest, db: &Database) -> Result<ExportContext, String> {
    let meeting = db
        .get_meeting(&request.meeting_id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(&request.meeting_id)?
        .map(PathBuf::from)
        .ok_or_else(|| "Meeting folder not found".to_string())?;
    let transcript = meeting
        .transcript_path
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok());

    let output_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("exports")
        .join(chrono::Local::now().format("%Y-%m").to_string());

    Ok(ExportContext {
        meeting,
        folder,
        transcript,
        output_dir,
    })
}

fn resolve_provider(id: &str) -> Result<Box<dyn StorageProvider>, String> {
    match id {
        "local_stub" => Ok(Box::new(LocalStubProvider)),
        "google_drive" | "box" | "dropbox" | "snowflake" | "supabase" | "mysql" | "postgresql" | "s3" | "webhook" => {
            Err(format!("{id} is not active yet. Use local_stub to validate export packaging."))
        }
        _ => Err(format!("Unknown export provider: {id}")),
    }
}

#[tauri::command]
pub async fn export_meeting_bundle(
    request: ExportRequest,
    db: tauri::State<'_, Database>,
) -> Result<ExportResult, String> {
    let context = build_export_context(&request, db.inner())?;
    let provider = resolve_provider(&request.provider_id)?;
    provider.export(&request, &context)
}

/// Collect all descendant folder IDs (recursive) for a given folder.
fn collect_subfolder_ids(folder_id: &str, all_folders: &[(String, String, Option<String>, Option<String>)]) -> HashSet<String> {
    let mut result = HashSet::new();
    result.insert(folder_id.to_string());
    let mut queue = vec![folder_id.to_string()];
    while let Some(parent) = queue.pop() {
        for (id, _, parent_id, _) in all_folders {
            if parent_id.as_deref() == Some(&parent) && !result.contains(id) {
                result.insert(id.clone());
                queue.push(id.clone());
            }
        }
    }
    result
}

/// Build folder breadcrumb path like "Work > Engineering > Architecture"
fn folder_breadcrumb(folder_id: &str, all_folders: &[(String, String, Option<String>, Option<String>)]) -> String {
    let mut parts = Vec::new();
    let mut current = Some(folder_id.to_string());
    while let Some(ref id) = current {
        if let Some((_, name, parent_id, _)) = all_folders.iter().find(|(fid, _, _, _)| fid == id) {
            parts.push(name.clone());
            current = parent_id.clone();
        } else {
            break;
        }
    }
    parts.reverse();
    parts.join(" > ")
}

fn format_duration(seconds: u64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}

#[tauri::command]
pub async fn export_meetings_markdown(
    request: MarkdownExportRequest,
    db: tauri::State<'_, Database>,
) -> Result<MarkdownExportResult, String> {
    // 1. Get all meetings (we'll filter in memory for flexibility)
    let all_meetings = db.get_meetings(&MeetingFilter {
        from_date: request.from_date.clone(),
        to_date: request.to_date.clone(),
        transcription_status: None,
        profile_id: None,
    })?;

    let all_folders = db.get_all_folders()?;
    let all_assignments = db.get_all_assignments()?;

    // 2. Filter meetings based on mode
    let filtered: Vec<&Meeting> = match request.mode {
        MarkdownExportMode::ByFolder => {
            let folder_ids = request.folder_ids.as_ref()
                .ok_or("folder_ids is required for by_folder mode")?;
            let mut target_folders = HashSet::new();
            for fid in folder_ids {
                if request.include_subfolders.unwrap_or(true) {
                    target_folders.extend(collect_subfolder_ids(fid, &all_folders));
                } else {
                    target_folders.insert(fid.clone());
                }
            }
            let meeting_ids: HashSet<&str> = all_assignments.iter()
                .filter(|(_, fid)| target_folders.contains(fid))
                .map(|(mid, _)| mid.as_str())
                .collect();
            all_meetings.iter().filter(|m| meeting_ids.contains(m.id.as_str())).collect()
        }
        MarkdownExportMode::ByDateRange => {
            // Already filtered by from_date/to_date in the DB query
            all_meetings.iter().collect()
        }
        MarkdownExportMode::All => {
            all_meetings.iter().collect()
        }
    };

    // Apply starred filter if requested
    let filtered: Vec<&Meeting> = if request.starred_only.unwrap_or(false) {
        filtered.into_iter().filter(|m| m.is_favorite).collect()
    } else {
        filtered
    };

    if filtered.is_empty() {
        return Err("No meetings match the selected filter.".to_string());
    }

    // 3. Build the folder lookup for breadcrumbs
    let assignment_map: std::collections::HashMap<&str, Vec<&str>> = {
        let mut map: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
        for (mid, fid) in &all_assignments {
            map.entry(mid.as_str()).or_default().push(fid.as_str());
        }
        map
    };

    // 4. Build markdown
    let mut md = String::with_capacity(filtered.len() * 2000);

    // Header
    md.push_str("# Memosa Export\n\n");
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    md.push_str(&format!("**Exported:** {}\n", now));

    match request.mode {
        MarkdownExportMode::ByFolder => {
            let breadcrumbs: Vec<String> = request.folder_ids.as_ref()
                .map(|ids| ids.iter().map(|fid| folder_breadcrumb(fid, &all_folders)).collect())
                .unwrap_or_default();
            let sub = if request.include_subfolders.unwrap_or(true) { " (including sub-collections)" } else { "" };
            md.push_str(&format!("**Filter:** Collections — {}{}\n", breadcrumbs.join(", "), sub));
        }
        MarkdownExportMode::ByDateRange => {
            let from = request.from_date.as_deref().unwrap_or("beginning");
            let to = request.to_date.as_deref().unwrap_or("now");
            md.push_str(&format!("**Filter:** Date Range — {} to {}\n", from, to));
        }
        MarkdownExportMode::All => {
            md.push_str("**Filter:** All meetings\n");
        }
    }
    md.push_str(&format!("**Meetings:** {}\n\n", filtered.len()));

    // Calculate total duration
    let total_duration: u64 = filtered.iter().map(|m| m.duration_seconds).sum();
    md.push_str(&format!("**Total Duration:** {}\n\n", format_duration(total_duration)));
    md.push_str("---\n\n");

    // 5. Each meeting
    for meeting in &filtered {
        md.push_str(&format!("## {}\n\n", meeting.title));
        md.push_str(&format!("**Date:** {} at {}\n", meeting.date, meeting.start_time));
        md.push_str(&format!("**Duration:** {}\n", format_duration(meeting.duration_seconds)));

        if !meeting.attendees.is_empty() {
            md.push_str(&format!("**Attendees:** {}\n", meeting.attendees.join(", ")));
        }
        if !meeting.tags.is_empty() {
            md.push_str(&format!("**Tags:** {}\n", meeting.tags.join(", ")));
        }
        if !meeting.people.is_empty() {
            md.push_str(&format!("**People:** {}\n", meeting.people.join(", ")));
        }
        if meeting.is_favorite {
            md.push_str("**Starred**\n");
        }

        // Folder breadcrumbs
        if let Some(folder_ids) = assignment_map.get(meeting.id.as_str()) {
            let breadcrumbs: Vec<String> = folder_ids.iter()
                .map(|fid| folder_breadcrumb(fid, &all_folders))
                .filter(|b| !b.is_empty())
                .collect();
            if !breadcrumbs.is_empty() {
                md.push_str(&format!("**Collections:** {}\n", breadcrumbs.join(" | ")));
            }
        }

        if let Some(ref summary) = meeting.summary {
            md.push_str(&format!("\n### Summary\n\n{}\n", summary));
        }

        // Read transcript
        if let Some(ref path) = meeting.transcript_path {
            if let Ok(content) = std::fs::read_to_string(path) {
                md.push_str("\n### Transcript\n\n");
                md.push_str(&content);
                md.push('\n');
            }
        }

        md.push_str("\n---\n\n");
    }

    // 6. Save to exports directory
    let export_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("exports");
    std::fs::create_dir_all(&export_dir)
        .map_err(|e| format!("Failed to create exports dir: {}", e))?;

    let filename = match request.mode {
        MarkdownExportMode::ByFolder => {
            let count = request.folder_ids.as_ref().map(|v| v.len()).unwrap_or(0);
            let label = if count == 1 {
                request.folder_ids.as_ref().unwrap()[0].replace("f-", "")
            } else {
                format!("{}-collections", count)
            };
            format!("memosa-export-{}-{}.md", label, chrono::Local::now().format("%Y%m%d-%H%M"))
        }
        MarkdownExportMode::ByDateRange => {
            let from = request.from_date.as_deref().unwrap_or("all");
            let to = request.to_date.as_deref().unwrap_or("now");
            format!("memosa-export-{}-to-{}.md", from, to)
        }
        MarkdownExportMode::All => {
            format!("memosa-export-all-{}.md", chrono::Local::now().format("%Y%m%d-%H%M"))
        }
    };

    let output_path = export_dir.join(&filename);
    let total_bytes = md.len();
    std::fs::write(&output_path, &md)
        .map_err(|e| format!("Failed to write export file: {}", e))?;

    Ok(MarkdownExportResult {
        output_path: output_path.to_string_lossy().to_string(),
        meeting_count: filtered.len(),
        total_bytes,
    })
}

#[tauri::command]
pub async fn reveal_export_in_finder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    let dir = if p.is_file() { p.parent().unwrap_or(p) } else { p };
    crate::storage::fs::open_in_finder(dir)
}
