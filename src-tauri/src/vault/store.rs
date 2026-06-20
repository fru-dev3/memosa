//! Vault filesystem store (spec 02). The ONLY module that touches the vault on disk.
//! Files-only: no database. Atomic writes (tmp + rename). Disk always wins.

use super::notes;
use super::types::{ConvMeta, NodeKind, Notes, Transcript, TreeNode};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Vault { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Ensure the vault root exists.
    pub fn ensure(&self) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::create_dir_all(self.root.join(".memosa").join("index"))?;
        Ok(())
    }

    fn abs(&self, rel: &str) -> PathBuf {
        let mut p = self.root.clone();
        for part in rel.split('/').filter(|s| !s.is_empty()) {
            p.push(part);
        }
        p
    }

    // ---- tree ----

    /// The full vault tree (domains → folders → conversations).
    pub fn tree(&self) -> io::Result<TreeNode> {
        let children = self.read_children(&self.root, "", true)?;
        let count = children.iter().map(conv_count).sum();
        Ok(TreeNode {
            kind: NodeKind::Folder,
            name: "memosa".into(),
            path: String::new(),
            count: Some(count),
            children,
        })
    }

    fn read_children(&self, dir: &Path, rel: &str, top: bool) -> io::Result<Vec<TreeNode>> {
        let mut nodes = Vec::new();
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return Ok(nodes),
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue; // .memosa, dotdirs
            }
            let child_rel = if rel.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel, name)
            };
            if is_conversation(&path) {
                nodes.push(TreeNode {
                    kind: NodeKind::Conversation,
                    name,
                    path: child_rel,
                    count: None,
                    children: Vec::new(),
                });
            } else {
                let kids = self.read_children(&path, &child_rel, false)?;
                let count = kids.iter().map(conv_count).sum();
                nodes.push(TreeNode {
                    kind: if top { NodeKind::Domain } else { NodeKind::Folder },
                    name,
                    path: child_rel,
                    count: Some(count),
                    children: kids,
                });
            }
        }
        nodes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(nodes)
    }

    /// Conversations directly inside `folder` (newest first).
    pub fn list(&self, folder: &str) -> io::Result<Vec<ConvMeta>> {
        let dir = self.abs(folder);
        let mut out = Vec::new();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() && is_conversation(&p) {
                    let rel = join_rel(folder, &entry.file_name().to_string_lossy());
                    if let Ok(meta) = self.read_meta(&rel) {
                        out.push(meta);
                    }
                }
            }
        }
        out.sort_by(|a, b| b.created.cmp(&a.created));
        Ok(out)
    }

    // ---- read ----

    pub fn read_meta(&self, id: &str) -> io::Result<ConvMeta> {
        let raw = fs::read_to_string(self.abs(id).join("meta.json"))?;
        serde_json::from_str(&raw).map_err(to_io)
    }

    pub fn transcript(&self, id: &str) -> io::Result<Transcript> {
        let path = self.abs(id).join("transcript.json");
        if !path.exists() {
            return Ok(Transcript {
                schema: 1,
                language: String::new(),
                model: String::new(),
                speakers: Default::default(),
                segments: Vec::new(),
            });
        }
        let raw = fs::read_to_string(path)?;
        serde_json::from_str(&raw).map_err(to_io)
    }

    pub fn notes(&self, id: &str) -> io::Result<Notes> {
        let path = self.abs(id).join("notes.md");
        if !path.exists() {
            return Ok(Notes::default());
        }
        Ok(notes::parse(&fs::read_to_string(path)?, id))
    }

    pub fn get(&self, id: &str) -> io::Result<(ConvMeta, Notes)> {
        Ok((self.read_meta(id)?, self.notes(id)?))
    }

    // ---- write ----

    /// Create a new conversation folder under `folder`; returns its id.
    pub fn create_conversation(&self, folder: &str, title: &str, created: &str) -> io::Result<String> {
        let slug = self.unique_slug(folder, title, created);
        let id = join_rel(folder, &slug);
        let dir = self.abs(&id);
        fs::create_dir_all(&dir)?;
        let meta = ConvMeta::new(id.clone(), title, created);
        self.write_meta(&meta)?;
        Ok(id)
    }

    pub fn write_meta(&self, meta: &ConvMeta) -> io::Result<()> {
        let json = serde_json::to_string_pretty(meta).map_err(to_io)?;
        atomic_write(&self.abs(&meta.id).join("meta.json"), json.as_bytes())
    }

    pub fn write_transcript(&self, id: &str, t: &Transcript) -> io::Result<()> {
        let dir = self.abs(id);
        let json = serde_json::to_string_pretty(t).map_err(to_io)?;
        atomic_write(&dir.join("transcript.json"), json.as_bytes())?;
        atomic_write(&dir.join("transcript.txt"), t.to_plaintext().as_bytes())?;
        self.touch(id)
    }

    pub fn write_notes(&self, id: &str, n: &Notes) -> io::Result<()> {
        let meta = self.read_meta(id)?;
        let date = meta.created.get(..10).unwrap_or("").to_string();
        let md = notes::serialize(n, &meta.title, &date, &meta.people, &meta.tags);
        atomic_write(&self.abs(id).join("notes.md"), md.as_bytes())?;
        self.touch(id)
    }

    pub fn set_tags(&self, id: &str, tags: Vec<String>) -> io::Result<()> {
        let mut meta = self.read_meta(id)?;
        meta.tags = tags;
        self.write_meta(&meta)
    }

    /// Toggle an action item by its visible text, rewriting only that line of notes.md.
    pub fn toggle_task(&self, id: &str, text: &str, done: bool) -> io::Result<()> {
        let path = self.abs(id).join("notes.md");
        let md = fs::read_to_string(&path)?;
        if let Some(updated) = notes::toggle_task(&md, text, done) {
            atomic_write(&path, updated.as_bytes())?;
        }
        Ok(())
    }

    // ---- structure ops (filesystem moves) ----

    pub fn create_folder(&self, path: &str) -> io::Result<()> {
        fs::create_dir_all(self.abs(path))
    }

    /// Move a conversation into `dest_folder`; returns its new id.
    pub fn move_conv(&self, id: &str, dest_folder: &str) -> io::Result<String> {
        let name = id.rsplit('/').next().unwrap_or(id).to_string();
        let new_id = join_rel(dest_folder, &name);
        let dest = self.abs(&new_id);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(self.abs(id), &dest)?;
        let mut meta = self.read_meta(&new_id)?;
        meta.id = new_id.clone();
        self.write_meta(&meta)?;
        Ok(new_id)
    }

    /// Retitle a conversation (re-slugs its directory); returns the new id.
    pub fn rename(&self, id: &str, title: &str) -> io::Result<String> {
        let folder = parent_of(id);
        let created = self.read_meta(id)?.created;
        let slug = self.unique_slug(&folder, title, &created);
        let new_id = join_rel(&folder, &slug);
        if new_id != id {
            fs::rename(self.abs(id), self.abs(&new_id))?;
        }
        let mut meta = self.read_meta(&new_id)?;
        meta.id = new_id.clone();
        meta.title = title.to_string();
        self.write_meta(&meta)?;
        Ok(new_id)
    }

    /// Soft-delete: move into `.memosa/trash/`.
    pub fn delete(&self, id: &str) -> io::Result<()> {
        let name = id.replace('/', "__");
        let trash = self.root.join(".memosa").join("trash");
        fs::create_dir_all(&trash)?;
        fs::rename(self.abs(id), trash.join(name))
    }

    // ---- helpers ----

    fn touch(&self, id: &str) -> io::Result<()> {
        if let Ok(mut meta) = self.read_meta(id) {
            meta.updated = Some(now_iso());
            self.write_meta(&meta)?;
        }
        Ok(())
    }

    fn unique_slug(&self, folder: &str, title: &str, created: &str) -> String {
        let base = slugify(title, created);
        let mut candidate = base.clone();
        let mut n = 2;
        while self.abs(&join_rel(folder, &candidate)).exists() {
            candidate = format!("{}-{}", base, n);
            n += 1;
        }
        candidate
    }
}

fn is_conversation(dir: &Path) -> bool {
    dir.join("meta.json").exists()
}

fn conv_count(node: &TreeNode) -> usize {
    match node.kind {
        NodeKind::Conversation => 1,
        _ => node.children.iter().map(conv_count).sum(),
    }
}

fn join_rel(folder: &str, name: &str) -> String {
    if folder.is_empty() {
        name.to_string()
    } else {
        format!("{}/{}", folder.trim_end_matches('/'), name)
    }
}

fn parent_of(id: &str) -> String {
    match id.rfind('/') {
        Some(i) => id[..i].to_string(),
        None => String::new(),
    }
}

/// `YYYY-MM-DD-kebab-title` from an ISO created stamp.
fn slugify(title: &str, created: &str) -> String {
    let date = created.get(..10).unwrap_or("undated");
    let mut kebab = String::new();
    let mut prev_dash = false;
    for ch in title.chars() {
        if ch.is_alphanumeric() {
            for c in ch.to_lowercase() {
                kebab.push(c);
            }
            prev_dash = false;
        } else if !prev_dash {
            kebab.push('-');
            prev_dash = true;
        }
    }
    let kebab = kebab.trim_matches('-');
    if kebab.is_empty() {
        date.to_string()
    } else {
        format!("{}-{}", date, kebab)
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!(
        "{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or("")
    ));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn to_io(e: serde_json::Error) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, e)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "memosa-vault-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&p);
        p
    }
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    #[test]
    fn create_read_list_tree() {
        let v = Vault::new(tmp_root());
        v.ensure().unwrap();
        v.create_folder("Life/Dad").unwrap();
        let id = v
            .create_conversation("Life/Dad", "Obie Insurance review", "2026-06-17T11:02:00Z")
            .unwrap();
        assert_eq!(id, "Life/Dad/2026-06-17-obie-insurance-review");

        let meta = v.read_meta(&id).unwrap();
        assert_eq!(meta.title, "Obie Insurance review");

        let list = v.list("Life/Dad").unwrap();
        assert_eq!(list.len(), 1);

        let tree = v.tree().unwrap();
        assert_eq!(tree.count, Some(1));
        // Life domain present
        let life = tree.children.iter().find(|n| n.name == "Life").unwrap();
        assert_eq!(life.kind, NodeKind::Domain);
        assert_eq!(life.count, Some(1));
        let _ = fs::remove_dir_all(v.root());
    }

    #[test]
    fn transcript_and_move() {
        let v = Vault::new(tmp_root());
        v.ensure().unwrap();
        let id = v.create_conversation("Work", "Standup", "2026-06-18T09:30:00Z").unwrap();
        let t = Transcript {
            schema: 1,
            language: "en".into(),
            model: "whisper".into(),
            speakers: Default::default(),
            segments: vec![super::super::types::Segment {
                start: 12.0,
                end: 15.0,
                speaker: String::new(),
                text: "hello world".into(),
            }],
        };
        v.write_transcript(&id, &t).unwrap();
        let txt = fs::read_to_string(v.abs(&id).join("transcript.txt")).unwrap();
        assert!(txt.contains("[00:12] hello world"));

        let new_id = v.move_conv(&id, "Life/Dad").unwrap();
        assert_eq!(new_id, "Life/Dad/2026-06-18-standup");
        assert!(v.read_meta(&new_id).is_ok());
        assert!(v.read_meta(&id).is_err());
        let _ = fs::remove_dir_all(v.root());
    }
}
