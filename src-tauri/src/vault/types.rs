//! Vault data types — the on-disk schemas from spec 01. Files-only; no database.
//! Every shape here serializes directly to/from the JSON/JSONL/Markdown in the vault.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

fn schema_one() -> u32 {
    1
}
fn default_source() -> String {
    "recording".into()
}
fn default_audio() -> String {
    "audio.m4a".into()
}

/// `meta.json` — conversation metadata (spec 01).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvMeta {
    #[serde(default = "schema_one")]
    pub schema: u32,
    /// Canonical id == vault-relative path, e.g. `Life/Dad/2026-06-17-obie-insurance-review`.
    pub id: String,
    pub title: String,
    /// ISO-8601 UTC.
    pub created: String,
    #[serde(default)]
    pub duration_sec: u64,
    #[serde(default)]
    pub people: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar_event_id: Option<String>,
    #[serde(default = "default_audio")]
    pub audio: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
}

impl ConvMeta {
    pub fn new(id: impl Into<String>, title: impl Into<String>, created: impl Into<String>) -> Self {
        ConvMeta {
            schema: 1,
            id: id.into(),
            title: title.into(),
            created: created.into(),
            duration_sec: 0,
            people: Vec::new(),
            tags: Vec::new(),
            source: "recording".into(),
            calendar_event_id: None,
            audio: "audio.m4a".into(),
            updated: None,
        }
    }
}

/// One transcript line.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    #[serde(default)]
    pub speaker: String,
    pub text: String,
}

/// `transcript.json` (spec 01).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcript {
    #[serde(default = "schema_one")]
    pub schema: u32,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub speakers: BTreeMap<String, String>,
    #[serde(default)]
    pub segments: Vec<Segment>,
}

impl Transcript {
    /// Derived `transcript.txt`: `[mm:ss] Speaker: text` per line.
    pub fn to_plaintext(&self) -> String {
        let mut out = String::new();
        for s in &self.segments {
            let m = (s.start as u64) / 60;
            let sec = (s.start as u64) % 60;
            let who = self.speakers.get(&s.speaker).cloned().unwrap_or(s.speaker.clone());
            if who.is_empty() {
                out.push_str(&format!("[{:02}:{:02}] {}\n", m, sec, s.text.trim()));
            } else {
                out.push_str(&format!("[{:02}:{:02}] {}: {}\n", m, sec, who, s.text.trim()));
            }
        }
        out
    }
}

/// An action item, source of truth = a GFM checkbox in `notes.md` (spec 01).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Task {
    #[serde(default)]
    pub conv: String,
    pub text: String,
    pub done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due: Option<String>,
}

/// Structured view of `notes.md`. `markdown` is the verbatim file (source of truth).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Notes {
    pub summary: String,
    pub decisions: Vec<String>,
    pub actions: Vec<Task>,
    pub markdown: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Domain,
    Folder,
    Conversation,
}

/// A node in the vault tree (spec 09).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeNode {
    pub kind: NodeKind,
    pub name: String,
    /// Vault-relative path with `/` separators.
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}
