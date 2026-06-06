//! Sync a meeting to external tools the user already uses.
//!
//! * Obsidian — write a markdown note into a user-chosen vault folder (purely
//!   local; no network).
//! * Notion — create a page in the user's database via their own integration
//!   token (stored in the Keychain). This sends the note + transcript to Notion,
//!   so it only runs when the user explicitly triggers it.

use crate::storage::{Database, SettingsManager};
use crate::types::Meeting;
use keyring::Entry;
use serde_json::{json, Value};
use std::path::Path;

const KEYCHAIN_SERVICE: &str = "com.memosa.app";
const NOTION_ACCOUNT: &str = "notion_token";
const NOTION_VERSION: &str = "2022-06-28";

// ─── Shared helpers ───────────────────────────────────────────────────────────

fn format_duration(seconds: u64) -> String {
    let h = seconds / 3600;
    let m = (seconds % 3600) / 60;
    if h > 0 {
        format!("{h}h {m}m")
    } else {
        format!("{m}m")
    }
}

/// Sanitize a meeting title for use as a filename.
fn safe_filename(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed
    }
}

/// Read a meeting's transcript markdown, or empty string if unavailable.
fn read_transcript(meeting: &Meeting, folder: &str) -> String {
    let fallback = Path::new(folder).join("transcript.md");
    let path = meeting
        .transcript_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or(fallback);
    std::fs::read_to_string(&path).unwrap_or_default()
}

/// Build a self-contained markdown note for a meeting.
fn build_markdown(meeting: &Meeting, transcript: &str) -> String {
    let mut md = String::new();
    md.push_str(&format!("# {}\n\n", meeting.title));
    md.push_str(&format!("**Date:** {} at {}\n", meeting.date, meeting.start_time));
    md.push_str(&format!("**Duration:** {}\n", format_duration(meeting.duration_seconds)));
    if !meeting.attendees.is_empty() {
        md.push_str(&format!("**Attendees:** {}\n", meeting.attendees.join(", ")));
    }
    if !meeting.people.is_empty() {
        md.push_str(&format!("**People:** {}\n", meeting.people.join(", ")));
    }
    if !meeting.tags.is_empty() {
        md.push_str(&format!("**Tags:** {}\n", meeting.tags.join(", ")));
    }
    md.push('\n');
    if let Some(summary) = meeting.summary.as_ref().filter(|s| !s.is_empty()) {
        md.push_str(&format!("## Summary\n\n{summary}\n\n"));
    }
    md.push_str("## Transcript\n\n");
    md.push_str(if transcript.is_empty() { "_No transcript available._\n" } else { transcript });
    md.push('\n');
    md
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_filename_strips_path_chars() {
        assert_eq!(safe_filename("Q3 Plan: roadmap/risks"), "Q3 Plan- roadmap-risks");
        assert_eq!(safe_filename(""), "Untitled");
        assert_eq!(safe_filename("   "), "Untitled");
    }

    #[test]
    fn format_duration_h_m() {
        assert_eq!(format_duration(0), "0m");
        assert_eq!(format_duration(90), "1m");
        assert_eq!(format_duration(3661), "1h 1m");
    }

    #[test]
    fn paragraph_blocks_chunks_and_caps() {
        let text = "para one\n\npara two\n\npara three";
        let (blocks, truncated) = paragraph_blocks(text, 2);
        assert_eq!(blocks.len(), 2);
        assert!(truncated);
        let (all, trunc2) = paragraph_blocks(text, 10);
        assert_eq!(all.len(), 3);
        assert!(!trunc2);
    }

    #[test]
    fn paragraph_blocks_splits_long_paragraph() {
        let long = "x".repeat(4100);
        let (blocks, _) = paragraph_blocks(&long, 10);
        // 4100 chars / 1900-byte chunks => 3 blocks.
        assert_eq!(blocks.len(), 3);
    }
}

fn load_meeting(db: &Database, meeting_id: &str) -> Result<(Meeting, String), String> {
    let meeting = db
        .get_meeting(meeting_id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(meeting_id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;
    Ok((meeting, folder))
}

// ─── Obsidian ─────────────────────────────────────────────────────────────────

/// Write the meeting note into `<vault>/Memosa/<title>-<date>.md`. Returns the path.
#[tauri::command]
pub async fn sync_meeting_to_obsidian(
    meeting_id: String,
    db: tauri::State<'_, Database>,
) -> Result<String, String> {
    let settings = SettingsManager::load();
    let vault = settings
        .obsidian_vault_path
        .filter(|p| !p.is_empty())
        .ok_or_else(|| "Set your Obsidian vault folder in Settings → Integrations first.".to_string())?;

    let (meeting, folder) = load_meeting(&db, &meeting_id)?;
    let transcript = read_transcript(&meeting, &folder);
    let md = build_markdown(&meeting, &transcript);

    let target_dir = Path::new(&vault).join("Memosa");
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Could not create Obsidian folder: {e}"))?;
    let date = &meeting.date[..10.min(meeting.date.len())];
    let filename = format!("{} - {}.md", safe_filename(&meeting.title), date);
    let path = target_dir.join(filename);
    std::fs::write(&path, md).map_err(|e| format!("Could not write note: {e}"))?;

    let path_str = path.to_string_lossy().to_string();
    crate::diagnostics::log(format!("sync: wrote Obsidian note {path_str}"));
    Ok(path_str)
}

// ─── Notion ───────────────────────────────────────────────────────────────────

fn notion_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, NOTION_ACCOUNT).map_err(|e| format!("Keychain entry error: {e}"))
}

fn load_notion_token() -> Option<String> {
    notion_entry().ok()?.get_password().ok().filter(|t| !t.is_empty())
}

/// Store (or clear, when empty) the Notion integration token in the Keychain.
#[tauri::command]
pub async fn set_notion_token(token: String) -> Result<(), String> {
    let entry = notion_entry()?;
    if token.trim().is_empty() {
        return match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keychain delete error: {e}")),
        };
    }
    entry
        .set_password(token.trim())
        .map_err(|e| format!("Keychain save error: {e}"))
}

/// True when a Notion token is stored (so the UI can show "connected").
#[tauri::command]
pub async fn notion_connected() -> Result<bool, String> {
    Ok(load_notion_token().is_some())
}

/// Chunk text into Notion paragraph blocks (<= 2000 chars each, capped count).
fn paragraph_blocks(text: &str, max_blocks: usize) -> (Vec<Value>, bool) {
    let mut blocks = Vec::new();
    let mut truncated = false;
    for para in text.split("\n\n") {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        // Notion caps rich-text content at 2000 chars per block.
        for chunk in para.as_bytes().chunks(1900) {
            if blocks.len() >= max_blocks {
                truncated = true;
                break;
            }
            let content = String::from_utf8_lossy(chunk).to_string();
            blocks.push(json!({
                "object": "block",
                "type": "paragraph",
                "paragraph": { "rich_text": [{ "type": "text", "text": { "content": content } }] }
            }));
        }
        if truncated {
            break;
        }
    }
    (blocks, truncated)
}

/// Find the database's title-property name (Notion requires the page's title to
/// be set on whichever property has type "title", whatever it's called).
async fn notion_title_property(
    client: &reqwest::Client,
    token: &str,
    database_id: &str,
) -> Result<String, String> {
    let resp = client
        .get(format!("https://api.notion.com/v1/databases/{database_id}"))
        .bearer_auth(token)
        .header("Notion-Version", NOTION_VERSION)
        .send()
        .await
        .map_err(|e| format!("Notion database request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Notion database error ({status}): {body}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let props = v
        .get("properties")
        .and_then(|p| p.as_object())
        .ok_or_else(|| "Notion database has no properties".to_string())?;
    for (name, def) in props {
        if def.get("type").and_then(|t| t.as_str()) == Some("title") {
            return Ok(name.clone());
        }
    }
    Err("Could not find a title property on the Notion database".to_string())
}

/// Create a Notion page for the meeting in the configured database. Returns the URL.
#[tauri::command]
pub async fn sync_meeting_to_notion(
    meeting_id: String,
    db: tauri::State<'_, Database>,
) -> Result<String, String> {
    let settings = SettingsManager::load();
    let database_id = settings.notion_database_id.trim().to_string();
    if database_id.is_empty() {
        return Err("Set your Notion database ID in Settings → Integrations first.".to_string());
    }
    let token = load_notion_token()
        .ok_or_else(|| "Add your Notion integration token in Settings → Integrations first.".to_string())?;

    let (meeting, folder) = load_meeting(&db, &meeting_id)?;
    let transcript = read_transcript(&meeting, &folder);

    let client = reqwest::Client::new();
    let title_prop = notion_title_property(&client, &token, &database_id).await?;

    // Build child blocks: summary + transcript.
    let mut children: Vec<Value> = Vec::new();
    if let Some(summary) = meeting.summary.as_ref().filter(|s| !s.is_empty()) {
        children.push(json!({
            "object": "block", "type": "heading_2",
            "heading_2": { "rich_text": [{ "type": "text", "text": { "content": "Summary" } }] }
        }));
        let (mut s, _) = paragraph_blocks(summary, 10);
        children.append(&mut s);
    }
    children.push(json!({
        "object": "block", "type": "heading_2",
        "heading_2": { "rich_text": [{ "type": "text", "text": { "content": "Transcript" } }] }
    }));
    // Notion accepts at most 100 children per page-create call.
    let remaining = 100usize.saturating_sub(children.len());
    let (mut t, truncated) = paragraph_blocks(&transcript, remaining);
    if t.is_empty() {
        t.push(json!({
            "object": "block", "type": "paragraph",
            "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "No transcript available." } }] }
        }));
    }
    children.append(&mut t);
    if truncated {
        children.push(json!({
            "object": "block", "type": "paragraph",
            "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "… transcript truncated; see the full note in Memosa." } }] }
        }));
    }

    let mut properties = serde_json::Map::new();
    properties.insert(
        title_prop,
        json!({ "title": [{ "text": { "content": meeting.title.clone() } }] }),
    );
    let body = json!({
        "parent": { "database_id": database_id },
        "properties": Value::Object(properties),
        "children": children
    });

    let resp = client
        .post("https://api.notion.com/v1/pages")
        .bearer_auth(&token)
        .header("Notion-Version", NOTION_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Notion request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Notion error ({status}): {text}"));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let url = v.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
    crate::diagnostics::log("sync: created Notion page");
    Ok(url)
}
