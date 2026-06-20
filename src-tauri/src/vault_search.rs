//! File-based search & task aggregation over the files-only vault (spec 03).
//!
//! No database. Search walks the vault tree via [`Vault`], reads each conversation's
//! `transcript.txt` (falling back to the derived plaintext of `transcript.json`) and
//! `notes.md`, then does case-insensitive substring matching and builds a snippet around
//! the best match. `tasks` aggregates GFM checkboxes from every `notes.md`.
//!
//! `mode = "exact"` is the keyword path. `mode = "semantic"` is a stub that falls back to
//! keyword matching: the standalone files-only build has no embeddings index to query
//! (the old DB-backed Ollama path in `src/search/mod.rs` is intentionally not depended on).

use crate::vault::{NodeKind, Task, TreeNode, Vault};
use crate::vault_cmds::vault_root;
use serde::Serialize;

/// One search result, ready to serialize to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    /// Conversation id (vault-relative path), e.g. `Life/Dad/2026-06-17-obie-insurance-review`.
    pub conv: String,
    pub title: String,
    /// Which file matched, vault-relative (e.g. `Life/Dad/.../notes.md`).
    pub path: String,
    /// A window of text around the match.
    pub snippet: String,
    pub score: f32,
    /// The conversation's `created` date (ISO), for ordering / display.
    pub date: String,
}

/// Characters of context to include on each side of a match in the snippet.
const SNIPPET_PAD: usize = 80;

/// Keyword/exact search over the vault. `mode` accepts `"exact"` (default) and `"semantic"`
/// (currently a keyword fallback). `scope` is a vault-relative path prefix filter.
pub fn search(q: &str, mode: &str, scope: Option<&str>) -> Vec<SearchHit> {
    let query = q.trim();
    if query.is_empty() {
        return Vec::new();
    }
    // "semantic" has no standalone index here, so it degrades to keyword matching.
    let _ = mode;

    let needle = query.to_lowercase();
    let v = Vault::new(vault_root());
    let scope_prefix = scope.map(normalize_prefix);

    let mut hits: Vec<SearchHit> = Vec::new();
    let tree = match v.tree() {
        Ok(t) => t,
        Err(_) => return hits,
    };

    let mut convs: Vec<String> = Vec::new();
    collect_convs(&tree, &mut convs);

    for conv in convs {
        if let Some(prefix) = &scope_prefix {
            if !in_scope(&conv, prefix) {
                continue;
            }
        }

        let (title, date) = match v.read_meta(&conv) {
            Ok(m) => (m.title, m.created),
            Err(_) => (conv.rsplit('/').next().unwrap_or(&conv).to_string(), String::new()),
        };

        // Match notes.md (weighted higher) and the transcript text.
        if let Ok(notes) = v.notes(&conv) {
            if !notes.markdown.is_empty() {
                if let Some((snippet, score)) = match_text(&notes.markdown, &needle, 1.5) {
                    hits.push(SearchHit {
                        conv: conv.clone(),
                        title: title.clone(),
                        path: format!("{}/notes.md", conv),
                        snippet,
                        score: bonus(score, &title, &needle),
                        date: date.clone(),
                    });
                }
            }
        }

        if let Some(text) = transcript_text(&v, &conv) {
            if let Some((snippet, score)) = match_text(&text, &needle, 1.0) {
                hits.push(SearchHit {
                    conv: conv.clone(),
                    title: title.clone(),
                    path: format!("{}/transcript.txt", conv),
                    snippet,
                    score: bonus(score, &title, &needle),
                    date: date.clone(),
                });
            }
        }
    }

    hits.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.date.cmp(&a.date))
    });
    hits
}

/// Aggregate action items (GFM checkboxes) from every `notes.md` in the vault.
/// `filter`: `"open"`/`"todo"` → undone only, `"done"`/`"closed"` → done only,
/// anything else (e.g. `"all"`/`""`) → everything.
pub fn tasks(filter: &str) -> Vec<Task> {
    let v = Vault::new(vault_root());
    let mut out: Vec<Task> = Vec::new();

    let tree = match v.tree() {
        Ok(t) => t,
        Err(_) => return out,
    };
    let mut convs: Vec<String> = Vec::new();
    collect_convs(&tree, &mut convs);

    let want = filter.trim().to_lowercase();
    for conv in convs {
        if let Ok(notes) = v.notes(&conv) {
            for task in notes.actions {
                let keep = match want.as_str() {
                    "open" | "todo" | "undone" => !task.done,
                    "done" | "closed" | "complete" => task.done,
                    _ => true,
                };
                if keep {
                    out.push(task);
                }
            }
        }
    }
    out
}

// ---- Tauri commands ----

#[tauri::command]
pub fn vault_search(q: String, mode: String, scope: Option<String>) -> Result<Vec<SearchHit>, String> {
    Ok(search(&q, &mode, scope.as_deref()))
}

#[tauri::command]
pub fn vault_tasks(filter: String) -> Result<Vec<Task>, String> {
    Ok(tasks(&filter))
}

// ---- helpers ----

/// Depth-first collection of every conversation id in the tree.
fn collect_convs(node: &TreeNode, out: &mut Vec<String>) {
    match node.kind {
        NodeKind::Conversation => out.push(node.path.clone()),
        _ => {
            for child in &node.children {
                collect_convs(child, out);
            }
        }
    }
}

/// Read `transcript.txt` semantics via the vault: the derived plaintext of `transcript.json`.
fn transcript_text(v: &Vault, conv: &str) -> Option<String> {
    match v.transcript(conv) {
        Ok(t) if !t.segments.is_empty() => Some(t.to_plaintext()),
        _ => None,
    }
}

/// Normalize a scope prefix: trim surrounding slashes/whitespace, lowercase for compares.
fn normalize_prefix(s: &str) -> String {
    s.trim().trim_matches('/').to_string()
}

/// Is `conv` under the (already-normalized) scope `prefix`? Matches on path segments so
/// `Life/Dad` matches `Life/Dad/...` but not `Life/Dadson/...`.
fn in_scope(conv: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return true;
    }
    let c = conv.to_lowercase();
    let p = prefix.to_lowercase();
    c == p || c.starts_with(&format!("{}/", p))
}

/// Find the first case-insensitive match of `needle` in `haystack` and build a snippet
/// window around it. Score = `weight * (1 + match_count.min(5))`. Returns None if absent.
fn match_text(haystack: &str, needle: &str, weight: f32) -> Option<(String, f32)> {
    let lower = haystack.to_lowercase();
    let first = lower.find(needle)?;

    // Count occurrences (capped) to give multi-hit conversations a higher score.
    let mut count = 0usize;
    let mut from = 0usize;
    while let Some(i) = lower[from..].find(needle) {
        count += 1;
        from += i + needle.len().max(1);
        if count >= 5 {
            break;
        }
    }

    let snippet = build_snippet(haystack, first, needle.len());
    let score = weight * (1.0 + count as f32);
    Some((snippet, score))
}

/// Build a single-line snippet window around the byte range `[start, start+len)`,
/// respecting char boundaries and collapsing whitespace.
fn build_snippet(text: &str, start: usize, len: usize) -> String {
    let lo = floor_char_boundary(text, start.saturating_sub(SNIPPET_PAD));
    let hi = ceil_char_boundary(text, (start + len + SNIPPET_PAD).min(text.len()));
    let mut window: String = text[lo..hi].split_whitespace().collect::<Vec<_>>().join(" ");
    if lo > 0 {
        window.insert_str(0, "… ");
    }
    if hi < text.len() {
        window.push_str(" …");
    }
    window
}

/// Small score bonus when the title itself matches the query.
fn bonus(score: f32, title: &str, needle: &str) -> f32 {
    if title.to_lowercase().contains(needle) {
        score + 2.0
    } else {
        score
    }
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}
