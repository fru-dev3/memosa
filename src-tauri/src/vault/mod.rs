//! Files-only vault — the single source of truth for Memosa 3.0 (specs 01 & 02).
//!
//! There is no database. Conversations live as directories on disk; each holds
//! `meta.json`, `transcript.json` (+ derived `.txt`), `notes.md`, and `audio.m4a`.
//! Domains and folders are real directories — the folder tree IS the data model.

mod notes;
mod store;
mod types;

pub use store::Vault;
pub use types::{ConvMeta, Notes, NodeKind, Segment, Task, Transcript, TreeNode};
