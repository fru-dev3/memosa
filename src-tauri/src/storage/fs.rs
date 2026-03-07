use crate::types::Meeting;
use std::path::{Path, PathBuf};

/// Returns the root storage directory from the settings value.
#[allow(dead_code)]
pub fn storage_root(settings_storage_path: &str) -> PathBuf {
    PathBuf::from(settings_storage_path)
}

/// Create a meeting folder and return its path.
/// Folder name format: {YYYY}-{MM}-{DD}_{HHMM}_{Sanitized-Title}
/// Full path: {root}/{YYYY}/{MM}-{MonthName}/{YYYY-MM-DD}_{HHMM}_{Sanitized-Title}/
pub fn create_meeting_folder(
    root: &Path,
    title: &str,
    start_time: &chrono::DateTime<chrono::Local>,
) -> Result<PathBuf, String> {
    let year = start_time.format("%Y").to_string();
    // e.g. "03-March"
    let month_folder = start_time.format("%m-%B").to_string();
    // e.g. "2026-03-05_0900"
    let date_prefix = start_time.format("%Y-%m-%d_%H%M").to_string();
    let sanitized_title = sanitize_title(title);

    let folder_name = format!("{}_{}", date_prefix, sanitized_title);
    let folder_path = root.join(&year).join(&month_folder).join(&folder_name);

    std::fs::create_dir_all(&folder_path)
        .map_err(|e| format!("Failed to create meeting folder: {}", e))?;

    Ok(folder_path)
}

/// Sanitize a title for use in a folder name.
/// Replaces non-alphanumeric characters (except '-' and '_') with '-',
/// trims leading/trailing '-', and truncates to 50 characters.
fn sanitize_title(title: &str) -> String {
    let sanitized: String = title
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    // Collapse multiple consecutive dashes, then trim
    let mut result = String::with_capacity(sanitized.len());
    let mut last_was_dash = false;
    for c in sanitized.chars() {
        if c == '-' {
            if !last_was_dash {
                result.push(c);
            }
            last_was_dash = true;
        } else {
            result.push(c);
            last_was_dash = false;
        }
    }

    let result = result.trim_matches('-').to_string();
    result.chars().take(50).collect()
}

/// Write metadata.json to a meeting folder.
pub fn write_metadata(folder: &Path, meeting: &Meeting) -> Result<(), String> {
    let path = folder.join("metadata.json");
    let json = serde_json::to_string_pretty(meeting)
        .map_err(|e| format!("Failed to serialize meeting: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write metadata.json: {}", e))?;
    Ok(())
}

/// Read metadata.json from a meeting folder.
pub fn read_metadata(folder: &Path) -> Result<Meeting, String> {
    let path = folder.join("metadata.json");
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read metadata.json: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse metadata.json: {}", e))
}

/// Read the current metadata.json, apply an in-place mutation via `updater`, then write it back.
pub fn update_metadata<F>(folder: &Path, updater: F) -> Result<(), String>
where
    F: FnOnce(&mut Meeting),
{
    let mut meeting = read_metadata(folder)?;
    updater(&mut meeting);
    write_metadata(folder, &meeting)
}

/// Walk the year/month/meeting directory tree under `root` and return every folder
/// that contains a `metadata.json` file. Used for a full DB rebuild/sync.
#[allow(dead_code)]
pub fn scan_all_meetings(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();

    // Level 1: year directories
    let year_entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return results,
    };

    for year_entry in year_entries.flatten() {
        let year_path = year_entry.path();
        if !year_path.is_dir() {
            continue;
        }

        // Level 2: month directories
        let month_entries = match std::fs::read_dir(&year_path) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for month_entry in month_entries.flatten() {
            let month_path = month_entry.path();
            if !month_path.is_dir() {
                continue;
            }

            // Level 3: meeting directories
            let meeting_entries = match std::fs::read_dir(&month_path) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for meeting_entry in meeting_entries.flatten() {
                let meeting_path = meeting_entry.path();
                if meeting_path.is_dir() && meeting_path.join("metadata.json").exists() {
                    results.push(meeting_path);
                }
            }
        }
    }

    results
}

/// Reveal a path in macOS Finder using NSWorkspace (sandbox-safe).
pub fn open_in_finder(folder: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::reveal_in_finder(folder)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(format!("Cannot open Finder on this platform: {}", folder.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_title_basic() {
        assert_eq!(sanitize_title("Team Standup"), "Team-Standup");
    }

    #[test]
    fn test_sanitize_title_special_chars() {
        assert_eq!(
            sanitize_title("Q1 Review: Budget & Goals"),
            "Q1-Review--Budget---Goals".trim_matches('-').to_string()
        );
        // collapsed version
        let result = sanitize_title("Q1 Review: Budget & Goals");
        assert!(!result.starts_with('-'));
        assert!(!result.ends_with('-'));
    }

    #[test]
    fn test_sanitize_title_truncation() {
        let long = "a".repeat(100);
        assert_eq!(sanitize_title(&long).len(), 50);
    }
}
