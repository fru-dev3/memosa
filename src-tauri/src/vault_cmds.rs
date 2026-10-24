//! Tauri command layer over the files-only Vault (spec 09). The frontend talks to the
//! vault only through these commands; it never touches the filesystem directly.

use crate::vault::{ConvMeta, Notes, Transcript, TreeNode, Vault};
use serde::Serialize;
use std::path::PathBuf;

pub fn config_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".memosa3")
}

fn pointer_file() -> PathBuf {
    config_dir().join("vault_path")
}

/// Security-scoped bookmark for a vault the user picked. Under the macOS sandbox
/// (App Store and Developer ID builds) a folder outside the container is only
/// reachable again after a relaunch through this bookmark.
fn bookmark_file() -> PathBuf {
    config_dir().join("vault_bookmark")
}

/// Resolve the saved bookmark once per process and start accessing it. Returns the
/// bookmark's current path (it follows the folder if the user moved it).
fn resolve_bookmark_once() -> Option<PathBuf> {
    static RESOLVED: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    RESOLVED
        .get_or_init(|| {
            let data = std::fs::read(bookmark_file()).ok()?;
            match crate::macos::resolve_security_bookmark(&data) {
                Ok((path, stale)) => {
                    if stale {
                        if let Ok(fresh) = crate::macos::create_security_bookmark(std::path::Path::new(&path)) {
                            let _ = std::fs::write(bookmark_file(), fresh);
                        }
                    }
                    Some(PathBuf::from(path))
                }
                Err(e) => {
                    crate::diagnostics::log(format!("vault bookmark not resolved: {e}"));
                    None
                }
            }
        })
        .clone()
}

/// `~/Documents/Memosa Vault`. Kept apart from the legacy recordings folder
/// (`~/Documents/Memosa`) so old meeting folders never show up as domains.
fn default_vault() -> PathBuf {
    dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Memosa Vault")
}

/// Resolve the active vault root: `$MEMOSA_VAULT`, then the pointer file, then the default. Public so the
/// MCP server, search, and migration modules read the same location.
static SESSION_ROOT: std::sync::Mutex<Option<Option<PathBuf>>> = std::sync::Mutex::new(None);

/// Set in this process after the user picks (Some) or resets (None) the vault, so the
/// change applies at once instead of after a relaunch.
fn set_session_root(root: Option<PathBuf>) {
    *SESSION_ROOT.lock().unwrap() = Some(root);
}

pub fn vault_root() -> PathBuf {
    if let Some(choice) = SESSION_ROOT.lock().unwrap().clone() {
        return choice.unwrap_or_else(default_vault);
    }
    if let Ok(p) = std::env::var("MEMOSA_VAULT") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(s) = std::fs::read_to_string(pointer_file()) {
        let s = s.trim();
        if !s.is_empty() {
            // A bookmark (when there is one) both grants sandbox access and follows
            // the folder if it was moved; the pointer file is the fallback.
            return resolve_bookmark_once().unwrap_or_else(|| PathBuf::from(s));
        }
    }
    default_vault()
}

fn vault() -> Result<Vault, String> {
    let root = vault_root();
    let v = Vault::new(&root);
    v.ensure().map_err(|e| unreachable_vault(&root, e))?;
    Ok(v)
}

/// A clear message when the vault folder cannot be opened (moved, unplugged, or
/// macOS no longer grants access), instead of a bare OS error.
fn unreachable_vault(root: &std::path::Path, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1) {
        format!(
            "Memosa can't open the vault folder {}. Choose it again in Settings (Change), or use the default.",
            root.display()
        )
    } else {
        format!("The vault folder {} can't be used: {e}", root.display())
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[derive(Serialize)]
pub struct ConvBundle {
    pub meta: ConvMeta,
    pub notes: Notes,
}

#[tauri::command]
pub fn vault_path() -> String {
    vault_root().to_string_lossy().to_string()
}

#[tauri::command]
pub fn vault_default_path() -> String {
    default_vault().to_string_lossy().to_string()
}

/// Point the app at a vault folder. Call it right after the folder picker, while
/// the sandbox still grants access to the picked folder, so the bookmark can be made.
/// Takes effect at once for this process and survives relaunches.
#[tauri::command]
pub fn vault_set_path(app_handle: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("Choose a folder for the vault.".into());
    }
    std::fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    // A folder can exist and still be off limits (the macOS sandbox only grants
    // folders the user picked). Prove read and write access before saving anything.
    probe_access(std::path::Path::new(&path)).map_err(|e| {
        format!("Memosa cannot use that folder ({e}). Choose it with Change so macOS lets Memosa in.")
    })?;
    match crate::macos::create_security_bookmark(std::path::Path::new(&path)) {
        Ok(data) => std::fs::write(bookmark_file(), data).map_err(|e| e.to_string())?,
        Err(e) => {
            // Outside the sandbox no bookmark is needed; keep going with the path.
            crate::diagnostics::log(format!("vault bookmark not created: {e}"));
            let _ = std::fs::remove_file(bookmark_file());
        }
    }
    std::fs::write(pointer_file(), &path).map_err(|e| e.to_string())?;
    set_session_root(Some(PathBuf::from(&path)));
    allow_assets(&app_handle);
    crate::vault_watch::restart(&app_handle);
    Ok(())
}

fn probe_access(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::read_dir(dir)?;
    let probe = dir.join(".memosa").join(".write-probe");
    std::fs::create_dir_all(probe.parent().unwrap())?;
    std::fs::write(&probe, b"ok")?;
    std::fs::remove_file(&probe)
}

/// Go back to the default vault location (the old folder and its files stay as they are).
#[tauri::command]
pub fn vault_reset_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let _ = std::fs::remove_file(pointer_file());
    let _ = std::fs::remove_file(bookmark_file());
    set_session_root(None);
    allow_assets(&app_handle);
    crate::vault_watch::restart(&app_handle);
    Ok(vault_path())
}

/// Let the webview stream audio from the vault (the audio player in the Transcript tab).
pub fn allow_assets(app_handle: &tauri::AppHandle) {
    use tauri::Manager;
    let root = vault_root();
    let _ = std::fs::create_dir_all(&root);
    if let Err(e) = app_handle.asset_protocol_scope().allow_directory(&root, true) {
        crate::diagnostics::log(format!("asset scope for vault failed: {e}"));
    }
}

/// Absolute path of a conversation's audio file, when it has one.
#[tauri::command]
pub fn vault_audio_path(id: String) -> Option<String> {
    let mut p = vault_root();
    for part in id.split('/').filter(|s| !s.is_empty() && *s != "." && *s != "..") {
        p.push(part);
    }
    let a = p.join("audio.m4a");
    a.exists().then(|| a.to_string_lossy().to_string())
}

#[tauri::command]
pub fn vault_tree() -> Result<TreeNode, String> {
    let v = vault()?;
    v.tree().map_err(|e| unreachable_vault(v.root(), e))
}

#[tauri::command]
pub fn vault_list(path: String) -> Result<Vec<ConvMeta>, String> {
    vault()?.list(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_get(id: String) -> Result<ConvBundle, String> {
    let (meta, notes) = vault()?.get(&id).map_err(|e| e.to_string())?;
    Ok(ConvBundle { meta, notes })
}

#[tauri::command]
pub fn vault_transcript(id: String) -> Result<Transcript, String> {
    vault()?.transcript(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_create_folder(path: String) -> Result<(), String> {
    vault()?.create_folder(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_create_conversation(folder: String, title: String) -> Result<String, String> {
    vault()?
        .create_conversation(&folder, &title, &now_iso())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_move(id: String, dest: String) -> Result<String, String> {
    vault()?.move_conv(&id, &dest).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_rename(id: String, title: String) -> Result<String, String> {
    vault()?.rename(&id, &title).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_delete(id: String) -> Result<(), String> {
    vault()?.delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_set_tags(id: String, tags: Vec<String>) -> Result<(), String> {
    vault()?.set_tags(&id, tags).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn task_toggle(conv: String, text: String, done: bool) -> Result<(), String> {
    vault()?.toggle_task(&conv, &text, done).map_err(|e| e.to_string())
}

/// Reveal the vault root (or a specific conversation folder) in the system file manager.
#[tauri::command]
pub fn vault_reveal(id: Option<String>) -> Result<(), String> {
    let mut path = vault_root();
    if let Some(id) = id {
        for part in id.split('/').filter(|s| !s.is_empty() && *s != "." && *s != "..") {
            path.push(part);
        }
    }
    // NSWorkspace, not `open`: spawning processes is not allowed in the sandbox.
    #[cfg(target_os = "macos")]
    crate::macos::reveal_in_finder(&path)?;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(&path).spawn().ok();
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn().ok();
    }
    Ok(())
}

/// Export a conversation's notes + transcript as a single Markdown string (for copy/save).
#[tauri::command]
pub fn vault_export_markdown(id: String) -> Result<String, String> {
    let v = vault()?;
    let (meta, notes) = v.get(&id).map_err(|e| e.to_string())?;
    let t = v.transcript(&id).map_err(|e| e.to_string())?;
    Ok(export_markdown(&meta, &notes.markdown, &t.to_plaintext()))
}

/// `# Title`, a date and length line, the notes body (without notes.md's YAML
/// front matter, which repeats the title) and the plain transcript.
fn export_markdown(meta: &ConvMeta, notes_md: &str, transcript: &str) -> String {
    let mins = if meta.duration_sec < 60 {
        "under 1 min".to_string()
    } else {
        format!("{} min", (meta.duration_sec + 30) / 60)
    };
    let mut out = format!("# {}\n\n_{}, {}_\n\n", meta.title, meta.created.get(..10).unwrap_or(""), mins);
    out.push_str(crate::vault::notes::strip_front_matter(notes_md).trim());
    out.push_str("\n\n## Transcript\n\n");
    out.push_str(transcript);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_drops_front_matter() {
        let meta = ConvMeta::new("Work/x", "Kickoff", "2026-10-18T09:00:00Z");
        let md = "---\ntitle: Kickoff\ndate: 2026-10-18\n---\n\n## Summary\nShip it.\n";
        let out = export_markdown(&meta, md, "[00:00] hi");
        assert!(out.starts_with("# Kickoff\n\n_2026-10-18, under 1 min_\n\n## Summary\nShip it."));
        assert!(!out.contains("title: Kickoff"));
        assert!(out.ends_with("## Transcript\n\n[00:00] hi"));
        assert_eq!(crate::vault::notes::strip_front_matter("no front matter"), "no front matter");
    }
}

/// Native file picker for importing an audio file into the vault. `None` = cancelled.
#[tauri::command]
pub async fn pick_audio_file(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    #[cfg(feature = "e2e")]
    if let Some(p) = crate::e2e::take_pick() {
        return Ok(p);
    }
    let picked = app_handle
        .dialog()
        .file()
        .set_title("Import audio into Memosa")
        .add_filter("Audio", &["m4a", "mp3", "wav", "aac", "mp4", "flac", "ogg"])
        .blocking_pick_file();
    match picked {
        None => Ok(None),
        Some(f) => f
            .into_path()
            .map(|p| Some(p.to_string_lossy().to_string()))
            .map_err(|e| e.to_string()),
    }
}

/// Native folder picker for the vault location. Unlike the legacy
/// `pick_storage_folder`, it never touches the legacy recordings `storage_path`.
#[tauri::command]
pub async fn pick_vault_folder(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    #[cfg(feature = "e2e")]
    if let Some(p) = crate::e2e::take_pick() {
        return Ok(p);
    }
    let picked = app_handle
        .dialog()
        .file()
        .set_title("Choose the Memosa vault folder")
        .set_directory(vault_root())
        .blocking_pick_folder();
    match picked {
        None => Ok(None),
        Some(f) => f
            .into_path()
            .map(|p| Some(p.to_string_lossy().to_string()))
            .map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod access_tests {
    #[test]
    fn probe_accepts_a_writable_folder_and_leaves_nothing() {
        let d = std::env::temp_dir().join(format!("memosa-probe-{}", std::process::id()));
        super::probe_access(&d).unwrap();
        assert!(!d.join(".memosa/.write-probe").exists());
        let _ = std::fs::remove_dir_all(d);
    }
}
