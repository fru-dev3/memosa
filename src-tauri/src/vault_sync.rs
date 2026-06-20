//! Google Drive text-only sync for the files-only vault (spec 08).
//!
//! DECIDED: only the TEXT files of a conversation are ever uploaded
//! (`meta.json`, `transcript.json`, `transcript.txt`, `notes.md`) plus the folder
//! structure. The recording (`audio.m4a`) and the rebuildable `.memosa/` folder are
//! NEVER synced — audio never leaves the Mac.
//!
//! The sync is a one-way mirror (local → Drive). Change detection is done against a
//! per-vault manifest (`.memosa/sync_manifest.json`, a map of vault-relative path →
//! SHA-256 hash). Files whose hash changed (or that are new) are uploaded; the Drive
//! tree mirrors the vault tree under a top-level `Memosa/` folder. Conflicts are never
//! destructive: this mirror only *creates/updates*, never deletes remote files.
//!
//! ## Tokens / scope
//! The existing Google OAuth grant (calendar) only requests
//! `calendar.readonly`, so it CANNOT be reused to write to Drive. Rather than block
//! compilation on a live Drive grant, a Drive access token is read from the Keychain
//! (account `google_drive_access_token`) if one has been injected there, or from the
//! `MEMOSA_DRIVE_TOKEN` env var for testing. When no Drive token is present, every
//! command still works: status reports `connected = false`, and `vault_sync_now`
//! computes the plan (what *would* upload) and returns a clear "not connected" status
//! instead of erroring.

use crate::vault::Vault;
use crate::vault_cmds::vault_root;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const KEYCHAIN_SERVICE: &str = "com.memosa.app";
const DRIVE_TOKEN_ACCOUNT: &str = "google_drive_access_token";
/// Top-level Drive folder the vault tree is mirrored into.
const DRIVE_ROOT_FOLDER: &str = "Memosa";

/// The only files that are ever uploaded. Audio is deliberately absent.
const SYNCABLE_FILES: &[&str] = &["meta.json", "transcript.json", "transcript.txt", "notes.md"];

// ---------------------------------------------------------------------------
// Persisted config + manifest
// ---------------------------------------------------------------------------

/// `.memosa/sync.json` — user-controlled sync configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    /// Master on/off switch. Off by default (privacy posture).
    #[serde(default)]
    pub enabled: bool,
    /// Always false per the product decision; persisted so the shape is explicit and
    /// the privacy gate can show "audio: never".
    #[serde(default)]
    pub include_audio: bool,
    /// ISO-8601 UTC timestamp of the last successful (or attempted) sync.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<String>,
}

impl Default for SyncConfig {
    fn default() -> Self {
        SyncConfig {
            enabled: false,
            include_audio: false,
            last_sync: None,
        }
    }
}

/// `.memosa/sync_manifest.json` — map of vault-relative path → SHA-256 hex of the bytes
/// that were last uploaded. Used purely for change detection.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Manifest {
    #[serde(default)]
    files: BTreeMap<String, String>,
}

// ---------------------------------------------------------------------------
// Public status / plan types
// ---------------------------------------------------------------------------

/// Status surfaced to the frontend. Serializes to camelCase-friendly snake fields.
#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    /// Whether sync is enabled in config.
    pub enabled: bool,
    /// ISO timestamp of last sync, or None if never synced.
    pub last: Option<String>,
    /// Number of TEXT files that differ from the manifest and would upload next run.
    pub pending: usize,
    /// Whether a usable Drive access token is currently available.
    pub connected: bool,
    /// Mirrors config: always false (audio never syncs). Lets the UI show the posture.
    pub include_audio: bool,
}

/// Result of a `vault_sync_now` invocation.
#[derive(Debug, Clone, Serialize)]
pub struct SyncReport {
    /// Files uploaded this run.
    pub uploaded: usize,
    /// Files that still differ but could not be uploaded (e.g. not connected).
    pub pending: usize,
    /// Non-fatal per-file errors (path: message).
    pub errors: Vec<String>,
    /// True if a Drive token was available and used.
    pub connected: bool,
    /// Human-readable status line for the UI.
    pub message: String,
    pub last: Option<String>,
}

/// One planned upload: which vault-relative file, and its current hash.
struct PlanItem {
    /// Vault-relative path, e.g. `Life/Dad/2026-06-17-foo/notes.md`.
    rel: String,
    /// Absolute path on disk.
    abs: PathBuf,
    hash: String,
}

// ---------------------------------------------------------------------------
// Config + manifest IO (under .memosa/, which itself never syncs)
// ---------------------------------------------------------------------------

fn memosa_dir(root: &Path) -> PathBuf {
    root.join(".memosa")
}

fn config_path(root: &Path) -> PathBuf {
    memosa_dir(root).join("sync.json")
}

fn manifest_path(root: &Path) -> PathBuf {
    memosa_dir(root).join("sync_manifest.json")
}

fn load_config(root: &Path) -> SyncConfig {
    match std::fs::read_to_string(config_path(root)) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => SyncConfig::default(),
    }
}

fn save_config(root: &Path, cfg: &SyncConfig) -> Result<(), String> {
    let dir = memosa_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(root), json).map_err(|e| e.to_string())
}

fn load_manifest(root: &Path) -> Manifest {
    match std::fs::read_to_string(manifest_path(root)) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => Manifest::default(),
    }
}

fn save_manifest(root: &Path, m: &Manifest) -> Result<(), String> {
    let dir = memosa_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    std::fs::write(manifest_path(root), json).map_err(|e| e.to_string())
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ---------------------------------------------------------------------------
// Drive token source (Keychain or env). No live Drive grant required to compile.
// ---------------------------------------------------------------------------

/// Read a Drive access token. Order: `MEMOSA_DRIVE_TOKEN` env (testing) → Keychain.
/// Returns None when no Drive scope/token has been provisioned — callers must degrade
/// gracefully rather than error.
fn drive_access_token() -> Option<String> {
    if let Ok(tok) = std::env::var("MEMOSA_DRIVE_TOKEN") {
        let tok = tok.trim().to_string();
        if !tok.is_empty() {
            return Some(tok);
        }
    }
    let entry = Entry::new(KEYCHAIN_SERVICE, DRIVE_TOKEN_ACCOUNT).ok()?;
    let tok = entry.get_password().ok()?;
    let tok = tok.trim().to_string();
    if tok.is_empty() {
        None
    } else {
        Some(tok)
    }
}

// ---------------------------------------------------------------------------
// Walk the vault → collect TEXT files → build a plan vs the manifest
// ---------------------------------------------------------------------------

/// Collect every syncable TEXT file in the vault, with its current content hash.
/// Walks the vault tree (skipping `.memosa` and any dotdir) and, for each conversation
/// directory, picks only the whitelisted text files. Audio is never collected.
fn collect_text_files(root: &Path) -> Vec<PlanItem> {
    let mut out = Vec::new();
    walk(root, root, &mut out);
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<PlanItem>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            // Never descend into .memosa or any dotdir (index, trash, etc.).
            if name.starts_with('.') {
                continue;
            }
            walk(root, &path, out);
        } else if SYNCABLE_FILES.contains(&name.as_str()) {
            if let Ok(bytes) = std::fs::read(&path) {
                let rel = rel_path(root, &path);
                out.push(PlanItem {
                    rel,
                    abs: path,
                    hash: hash_bytes(&bytes),
                });
            }
        }
        // Any other file (notably audio.m4a) is silently ignored.
    }
}

/// Vault-relative path with `/` separators.
fn rel_path(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .ok()
        .map(|r| {
            r.components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_else(|| p.to_string_lossy().to_string())
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(out.len() * 2);
    for b in out {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// The subset of collected files whose hash differs from (or is absent in) the manifest.
fn plan_changed(files: &[PlanItem], manifest: &Manifest) -> Vec<usize> {
    let mut idx = Vec::new();
    for (i, f) in files.iter().enumerate() {
        match manifest.files.get(&f.rel) {
            Some(prev) if prev == &f.hash => {}
            _ => idx.push(i),
        }
    }
    idx
}

/// Count of files that currently differ from the manifest (pending uploads).
fn pending_count(root: &Path) -> usize {
    let files = collect_text_files(root);
    let manifest = load_manifest(root);
    plan_changed(&files, &manifest).len()
}

// ---------------------------------------------------------------------------
// Drive REST: ensure folder path, upload (multipart/related, no extra crate feature)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DriveFile {
    id: String,
}

#[derive(Deserialize)]
struct DriveList {
    #[serde(default)]
    files: Vec<DriveFile>,
}

/// Find a Drive folder by name under `parent` ("root" for the top level), or create it.
/// Returns the folder id. Used to materialize each path segment of the vault tree.
async fn ensure_folder(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    parent: &str,
) -> Result<String, String> {
    let safe_name = name.replace('\'', "\\'");
    let q = format!(
        "mimeType = 'application/vnd.google-apps.folder' and name = '{}' and '{}' in parents and trashed = false",
        safe_name, parent
    );
    let resp = client
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(token)
        .query(&[
            ("q", q.as_str()),
            ("fields", "files(id,name)"),
            ("spaces", "drive"),
        ])
        .send()
        .await
        .map_err(|e| format!("Drive folder query failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Drive folder query failed ({status}): {body}"));
    }
    let list: DriveList = resp
        .json()
        .await
        .map_err(|e| format!("Drive folder query parse failed: {e}"))?;
    if let Some(f) = list.files.into_iter().next() {
        return Ok(f.id);
    }

    // Not found → create it.
    let metadata = serde_json::json!({
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent],
    });
    let resp = client
        .post("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(token)
        .query(&[("fields", "id")])
        .json(&metadata)
        .send()
        .await
        .map_err(|e| format!("Drive folder create failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Drive folder create failed ({status}): {body}"));
    }
    let created: DriveFile = resp
        .json()
        .await
        .map_err(|e| format!("Drive folder create parse failed: {e}"))?;
    Ok(created.id)
}

/// Resolve (creating as needed) the Drive folder id for a vault-relative *directory*
/// path, always rooted under the top-level `Memosa/` folder. Caches resolved ids so a
/// single sync run doesn't re-query the same folder repeatedly.
async fn resolve_dir(
    client: &reqwest::Client,
    token: &str,
    dir_rel: &str,
    cache: &mut BTreeMap<String, String>,
) -> Result<String, String> {
    if let Some(id) = cache.get(dir_rel) {
        return Ok(id.clone());
    }
    // Always start at the Memosa root folder.
    let root_id = match cache.get("\0memosa_root") {
        Some(id) => id.clone(),
        None => {
            let id = ensure_folder(client, token, DRIVE_ROOT_FOLDER, "root").await?;
            cache.insert("\0memosa_root".to_string(), id.clone());
            id
        }
    };
    let mut parent = root_id;
    let mut accum = String::new();
    for seg in dir_rel.split('/').filter(|s| !s.is_empty()) {
        accum = if accum.is_empty() {
            seg.to_string()
        } else {
            format!("{}/{}", accum, seg)
        };
        if let Some(id) = cache.get(&accum) {
            parent = id.clone();
            continue;
        }
        let id = ensure_folder(client, token, seg, &parent).await?;
        cache.insert(accum.clone(), id.clone());
        parent = id;
    }
    cache.insert(dir_rel.to_string(), parent.clone());
    Ok(parent)
}

/// Find an existing Drive file by name within a parent folder, returning its id.
async fn find_file(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    parent: &str,
) -> Result<Option<String>, String> {
    let safe_name = name.replace('\'', "\\'");
    let q = format!(
        "name = '{}' and '{}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'",
        safe_name, parent
    );
    let resp = client
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(token)
        .query(&[("q", q.as_str()), ("fields", "files(id,name)"), ("spaces", "drive")])
        .send()
        .await
        .map_err(|e| format!("Drive file query failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Drive file query failed ({status}): {body}"));
    }
    let list: DriveList = resp
        .json()
        .await
        .map_err(|e| format!("Drive file query parse failed: {e}"))?;
    Ok(list.files.into_iter().next().map(|f| f.id))
}

/// Upload (create or update) one text file into `parent`, by raw multipart/related
/// (so we don't need reqwest's `multipart` feature). Content type is plain/JSON text.
async fn upload_file(
    client: &reqwest::Client,
    token: &str,
    name: &str,
    parent: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let content_type = if name.ends_with(".json") {
        "application/json"
    } else if name.ends_with(".md") {
        "text/markdown"
    } else {
        "text/plain"
    };

    let existing = find_file(client, token, name, parent).await?;
    let boundary = "memosa_drive_boundary_8f3a";

    // multipart/related: metadata part + media part.
    let metadata = if existing.is_some() {
        // On update, parents are immutable via this endpoint; only send name.
        serde_json::json!({ "name": name })
    } else {
        serde_json::json!({ "name": name, "parents": [parent] })
    };
    let meta_json = serde_json::to_string(&metadata).map_err(|e| e.to_string())?;

    let mut body: Vec<u8> = Vec::new();
    let preamble = format!(
        "--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{b}\r\nContent-Type: {ct}\r\n\r\n",
        b = boundary,
        meta = meta_json,
        ct = content_type
    );
    body.extend_from_slice(preamble.as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

    let (url, method_is_patch) = match &existing {
        Some(id) => (
            format!(
                "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=multipart",
                id
            ),
            true,
        ),
        None => (
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart".to_string(),
            false,
        ),
    };

    let req = if method_is_patch {
        client.patch(&url)
    } else {
        client.post(&url)
    };
    let resp = req
        .bearer_auth(token)
        .header(
            "Content-Type",
            format!("multipart/related; boundary={}", boundary),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Drive upload failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("Drive upload failed ({status}): {msg}"));
    }
    Ok(())
}

/// Directory portion of a vault-relative file path (`a/b/notes.md` → `a/b`).
fn dir_of(rel: &str) -> String {
    match rel.rfind('/') {
        Some(i) => rel[..i].to_string(),
        None => String::new(),
    }
}

fn file_name_of(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

// ---------------------------------------------------------------------------
// Core run: compute plan, upload changed files, update the manifest.
// ---------------------------------------------------------------------------

async fn run_sync(root: &Path) -> SyncReport {
    let mut cfg = load_config(root);
    let files = collect_text_files(root);
    let mut manifest = load_manifest(root);
    let changed = plan_changed(&files, &manifest);
    let pending = changed.len();

    let token = match drive_access_token() {
        Some(t) => t,
        None => {
            return SyncReport {
                uploaded: 0,
                pending,
                errors: Vec::new(),
                connected: false,
                message: format!(
                    "Not connected to Google Drive — {} text file(s) ready to upload once a Drive scope is granted. Audio is never synced.",
                    pending
                ),
                last: cfg.last_sync.clone(),
            };
        }
    };

    if !cfg.enabled {
        return SyncReport {
            uploaded: 0,
            pending,
            errors: Vec::new(),
            connected: true,
            message: "Sync is connected but disabled. Enable it to upload.".to_string(),
            last: cfg.last_sync.clone(),
        };
    }

    let client = reqwest::Client::new();
    let mut dir_cache: BTreeMap<String, String> = BTreeMap::new();
    let mut uploaded = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for i in changed {
        let item = &files[i];
        let dir_rel = dir_of(&item.rel);
        let name = file_name_of(&item.rel);

        let parent = match resolve_dir(&client, &token, &dir_rel, &mut dir_cache).await {
            Ok(p) => p,
            Err(e) => {
                errors.push(format!("{}: {}", item.rel, e));
                continue;
            }
        };
        let bytes = match std::fs::read(&item.abs) {
            Ok(b) => b,
            Err(e) => {
                errors.push(format!("{}: read failed: {}", item.rel, e));
                continue;
            }
        };
        match upload_file(&client, &token, &name, &parent, &bytes).await {
            Ok(()) => {
                manifest.files.insert(item.rel.clone(), item.hash.clone());
                uploaded += 1;
            }
            Err(e) => errors.push(format!("{}: {}", item.rel, e)),
        }
    }

    let _ = save_manifest(root, &manifest);
    cfg.last_sync = Some(now_iso());
    let _ = save_config(root, &cfg);

    let still_pending = pending.saturating_sub(uploaded);
    let message = if errors.is_empty() {
        format!("Uploaded {} text file(s) to Drive/Memosa. Audio stays on this Mac.", uploaded)
    } else {
        format!(
            "Uploaded {} file(s); {} error(s). Conflicts are never destructive.",
            uploaded,
            errors.len()
        )
    };

    SyncReport {
        uploaded,
        pending: still_pending,
        errors,
        connected: true,
        message,
        last: cfg.last_sync.clone(),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Current sync status: enabled flag, last sync time, pending text-file count, and
/// whether a Drive token is available.
#[tauri::command]
pub async fn vault_sync_status() -> Result<SyncStatus, String> {
    let root = vault_root();
    // Ensure the vault root exists so manifest/config reads are well-defined.
    Vault::new(&root).ensure().map_err(|e| e.to_string())?;
    let cfg = load_config(&root);
    let pending = pending_count(&root);
    Ok(SyncStatus {
        enabled: cfg.enabled,
        last: cfg.last_sync.clone(),
        pending,
        connected: drive_access_token().is_some(),
        include_audio: false,
    })
}

/// Run a sync now (local → Drive, text only). Degrades gracefully when no Drive token
/// is present, returning the plan instead of an error.
#[tauri::command]
pub async fn vault_sync_now() -> Result<SyncReport, String> {
    let root = vault_root();
    Vault::new(&root).ensure().map_err(|e| e.to_string())?;
    Ok(run_sync(&root).await)
}

/// Persist sync settings. `include_audio` is forced to false per the product decision —
/// audio never leaves the device — regardless of what the caller passes.
#[tauri::command]
pub async fn vault_sync_set(enabled: bool, include_audio: bool) -> Result<SyncStatus, String> {
    let _ = include_audio; // intentionally ignored; audio is never synced.
    let root = vault_root();
    Vault::new(&root).ensure().map_err(|e| e.to_string())?;
    let mut cfg = load_config(&root);
    cfg.enabled = enabled;
    cfg.include_audio = false;
    save_config(&root, &cfg)?;
    let pending = pending_count(&root);
    Ok(SyncStatus {
        enabled: cfg.enabled,
        last: cfg.last_sync.clone(),
        pending,
        connected: drive_access_token().is_some(),
        include_audio: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "memosa-sync-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&p);
        p
    }
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    fn write(p: &Path, body: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }

    #[test]
    fn collects_text_files_never_audio_or_memosa() {
        let root = tmp_root();
        let conv = root.join("Life/Dad/2026-06-17-foo");
        write(&conv.join("meta.json"), "{}");
        write(&conv.join("transcript.json"), "{}");
        write(&conv.join("transcript.txt"), "hi");
        write(&conv.join("notes.md"), "# notes");
        // These must NEVER be collected:
        write(&conv.join("audio.m4a"), "BINARY-AUDIO");
        write(&root.join(".memosa/index/whatever.bin"), "idx");
        write(&root.join(".memosa/sync_manifest.json"), "{}");

        let files = collect_text_files(&root);
        let rels: Vec<&str> = files.iter().map(|f| f.rel.as_str()).collect();

        assert!(rels.contains(&"Life/Dad/2026-06-17-foo/meta.json"));
        assert!(rels.contains(&"Life/Dad/2026-06-17-foo/transcript.json"));
        assert!(rels.contains(&"Life/Dad/2026-06-17-foo/transcript.txt"));
        assert!(rels.contains(&"Life/Dad/2026-06-17-foo/notes.md"));
        assert_eq!(files.len(), 4, "only the 4 text files, nothing else");
        assert!(
            !rels.iter().any(|r| r.contains("audio.m4a")),
            "audio must never be collected"
        );
        assert!(
            !rels.iter().any(|r| r.contains(".memosa")),
            ".memosa must never be collected"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plan_only_includes_changed_files() {
        let root = tmp_root();
        let conv = root.join("Work/2026-06-18-standup");
        write(&conv.join("meta.json"), "{\"a\":1}");
        write(&conv.join("notes.md"), "v1");

        let files = collect_text_files(&root);
        // Empty manifest → everything is pending.
        let empty = Manifest::default();
        assert_eq!(plan_changed(&files, &empty).len(), 2);

        // Manifest matching current hashes → nothing pending.
        let mut m = Manifest::default();
        for f in &files {
            m.files.insert(f.rel.clone(), f.hash.clone());
        }
        assert_eq!(plan_changed(&files, &m).len(), 0);

        // Change one file → exactly one pending.
        write(&conv.join("notes.md"), "v2-changed");
        let files2 = collect_text_files(&root);
        let changed = plan_changed(&files2, &m);
        assert_eq!(changed.len(), 1);
        assert!(files2[changed[0]].rel.ends_with("notes.md"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn config_roundtrip_forces_audio_false() {
        let root = tmp_root();
        fs::create_dir_all(&root).unwrap();
        let mut cfg = SyncConfig::default();
        cfg.enabled = true;
        cfg.include_audio = false;
        save_config(&root, &cfg).unwrap();
        let loaded = load_config(&root);
        assert!(loaded.enabled);
        assert!(!loaded.include_audio);
        let _ = fs::remove_dir_all(&root);
    }
}
