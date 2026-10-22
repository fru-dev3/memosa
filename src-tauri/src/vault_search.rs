//! File-based search & task aggregation over the files-only vault (spec 03).
//!
//! No database. Search walks the vault tree via [`Vault`], reads each conversation's
//! `transcript.txt` (falling back to the derived plaintext of `transcript.json`) and
//! `notes.md`, then does case-insensitive substring matching and builds a snippet around
//! the best match. `tasks` aggregates GFM checkboxes from every `notes.md`.
//!
//! `mode = "exact"` matches the whole phrase. The `vault_search` command answers
//! `mode = "semantic"` from the local embedding index (`vault_embed`) and falls back to
//! word-level keyword matching when there is no index or no local model.

use crate::vault::{NodeKind, Task, TreeNode, Vault};
use crate::vault_cmds::vault_root;
use serde::Serialize;

/// One search result, ready to serialize to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    /// Conversation id (vault-relative path), e.g. `Work/Northwind/2026-06-17-acme-insurance-review`.
    pub conv: String,
    pub title: String,
    /// Which file matched, vault-relative (e.g. `Work/Northwind/.../notes.md`).
    pub path: String,
    /// A window of text around the match.
    pub snippet: String,
    pub score: f32,
    /// The conversation's `created` date (ISO), for ordering / display.
    pub date: String,
}

/// Characters of context to include on each side of a match in the snippet.
const SNIPPET_PAD: usize = 80;

/// Keyword search over the vault. `mode = "exact"` matches the whole phrase; any other
/// mode (the keyword fallback for "semantic" and for Ask) matches the significant words
/// of the query, so "what did we decide about the budget" still finds "budget".
/// `scope` is a vault-relative path prefix filter. One hit per conversation (the best).
pub fn search(q: &str, mode: &str, scope: Option<&str>) -> Vec<SearchHit> {
    search_in(&Vault::new(vault_root()), q, mode, scope)
}

pub fn search_in(v: &Vault, q: &str, mode: &str, scope: Option<&str>) -> Vec<SearchHit> {
    let query = q.trim();
    if query.is_empty() {
        return Vec::new();
    }
    if mode == "exact" {
        return search_needles(v, &[query.to_lowercase()], scope);
    }
    let terms = significant_terms(query);
    if terms.is_empty() {
        return search_needles(v, &[query.to_lowercase()], scope);
    }
    search_needles(v, &terms, scope)
}

/// Lowercased words of 3+ letters that are not common stopwords.
fn significant_terms(q: &str) -> Vec<String> {
    const STOP: &[&str] = &[
        "the", "and", "for", "are", "was", "were", "what", "when", "where", "which", "who",
        "why", "how", "did", "does", "about", "with", "that", "this", "from", "have", "has",
        "had", "our", "you", "your", "can", "could", "would", "should", "into", "any", "all",
        "say", "said", "tell", "there", "their", "they", "them", "then", "than", "been",
    ];
    let mut out: Vec<String> = Vec::new();
    for w in q
        .split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_lowercase())
        .filter(|w| w.chars().count() >= 3 && !STOP.contains(&w.as_str()))
    {
        if !out.contains(&w) {
            out.push(w);
        }
    }
    out
}

fn search_needles(v: &Vault, needles: &[String], scope: Option<&str>) -> Vec<SearchHit> {
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
                if let Some((snippet, score)) = match_any(&notes.markdown, needles, 1.5) {
                    hits.push(SearchHit {
                        conv: conv.clone(),
                        title: title.clone(),
                        path: format!("{}/notes.md", conv),
                        snippet,
                        score: bonus(score, &title, needles),
                        date: date.clone(),
                    });
                }
            }
        }

        if let Some(text) = transcript_text(v, &conv) {
            if let Some((snippet, score)) = match_any(&text, needles, 1.0) {
                hits.push(SearchHit {
                    conv: conv.clone(),
                    title: title.clone(),
                    path: format!("{}/transcript.txt", conv),
                    snippet,
                    score: bonus(score, &title, needles),
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
    // Notes and transcript can both match; keep the best hit per conversation.
    let mut seen = std::collections::HashSet::new();
    hits.retain(|h| seen.insert(h.conv.clone()));
    hits
}

/// Sum of per-word matches; the snippet comes from the first word that matches.
fn match_any(haystack: &str, needles: &[String], weight: f32) -> Option<(String, f32)> {
    let mut best: Option<(String, f32)> = None;
    let mut total = 0.0;
    for n in needles {
        if let Some((snip, score)) = match_text(haystack, n, weight) {
            total += score;
            if best.is_none() {
                best = Some((snip, 0.0));
            }
        }
    }
    best.map(|(snip, _)| (snip, total))
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

/// `semantic` uses the local embedding index when it exists and Ollama answers;
/// otherwise it falls back to keyword matching, so search never just fails.
#[tauri::command]
pub async fn vault_search(q: String, mode: String, scope: Option<String>) -> Result<Vec<SearchHit>, String> {
    if mode == "semantic" {
        if let Ok(hits) = crate::vault_embed::semantic_search(&q, scope.as_deref(), 20).await {
            if !hits.is_empty() {
                return Ok(hits);
            }
        }
    }
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
/// `Work/Northwind` matches `Work/Northwind/...` but not `Work/Northwindson/...`.
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

/// Small score bonus for each query word the title itself contains.
fn bonus(score: f32, title: &str, needles: &[String]) -> f32 {
    let t = title.to_lowercase();
    score + 2.0 * needles.iter().filter(|n| t.contains(n.as_str())).count() as f32
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{Notes, Segment, Task, Transcript};

    fn sample_vault() -> (Vault, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("memosa-search-{}-{}", std::process::id(), rand::random::<u32>()));
        let v = Vault::new(&root);
        v.ensure().unwrap();
        let id = v.create_conversation("Work/Northwind", "Budget review", "2026-06-17T10:00:00Z").unwrap();
        v.write_transcript(&id, &Transcript {
            schema: 1, language: "en".into(), model: "test".into(), speakers: Default::default(),
            segments: vec![Segment { start: 0.0, end: 3.0, speaker: String::new(), text: "Sam Lee said the budget for Q3 is approved.".into() }],
        }).unwrap();
        v.write_notes(&id, &Notes {
            summary: "We approved the budget.".into(), decisions: vec![],
            actions: vec![Task { conv: id.clone(), text: "Send the budget to finance".into(), done: false, owner: None, due: None }],
            markdown: String::new(),
        }).unwrap();
        (v, root)
    }

    #[test]
    fn exact_needs_the_whole_phrase_keyword_needs_words() {
        let (v, root) = sample_vault();
        assert!(search_in(&v, "what did we decide about the budget", "exact", None).is_empty());
        let hits = search_in(&v, "what did we decide about the budget", "semantic", None);
        assert_eq!(hits.len(), 1, "one hit per conversation, notes and transcript deduped");
        assert_eq!(hits[0].title, "Budget review");
        assert_eq!(search_in(&v, "budget for Q3", "exact", None).len(), 1);
        assert!(search_in(&v, "budget", "exact", Some("Life")).is_empty(), "scope filters");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stopwords_are_dropped() {
        assert_eq!(significant_terms("What did we decide about the budget?"), vec!["decide", "budget"]);
        assert!(significant_terms("a an of").is_empty());
    }
}
