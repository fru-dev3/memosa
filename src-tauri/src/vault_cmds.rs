//! Tauri command layer over the files-only Vault (spec 09). The frontend talks to the
//! vault only through these commands; it never touches the filesystem directly.

use crate::vault::{ConvMeta, Notes, Transcript, TreeNode, Vault};
use serde::Serialize;
use std::path::PathBuf;

fn pointer_file() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".memosa3")
        .join("vault_path")
}

fn default_vault() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Documents/fru/vault/memosa")
}

/// Resolve the active vault root: `$MEMOSA_VAULT` → pointer file → default. Public so the
/// MCP server, search, and migration modules read the same location.
pub fn vault_root() -> PathBuf {
    if let Ok(p) = std::env::var("MEMOSA_VAULT") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(s) = std::fs::read_to_string(pointer_file()) {
        let s = s.trim();
        if !s.is_empty() {
            return PathBuf::from(s);
        }
    }
    default_vault()
}

fn vault() -> Result<Vault, String> {
    let v = Vault::new(vault_root());
    v.ensure().map_err(|e| e.to_string())?;
    Ok(v)
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
pub fn vault_set_path(path: String) -> Result<(), String> {
    let pf = pointer_file();
    if let Some(parent) = pf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(pf, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_tree() -> Result<TreeNode, String> {
    vault()?.tree().map_err(|e| e.to_string())
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
        for part in id.split('/').filter(|s| !s.is_empty()) {
            path.push(part);
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
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
    let mut out = format!("# {}\n\n", meta.title);
    out.push_str(&format!("_{} · {} min_\n\n", &meta.created.get(..10).unwrap_or(""), meta.duration_sec / 60));
    out.push_str(notes.markdown.trim());
    out.push_str("\n\n## Transcript\n\n");
    out.push_str(&t.to_plaintext());
    Ok(out)
}
