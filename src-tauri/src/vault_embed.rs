//! Local semantic search over the files-only vault (spec 03 + 05).
//!
//! Files-only: no database. Embeddings live in `.memosa/index/embeddings.jsonl`
//! (one `{conv,chunk,start,text,vector}` JSON object per line) and a change-detection
//! manifest lives in `.memosa/index/manifest.json` (`{ "<conv>": {hash,mtime} }`).
//! Both are fully rebuildable from the vault; deleting `.memosa/index/` loses nothing.
//!
//! Each conversation transcript is chunked (~512 tokens), every chunk is embedded via the
//! local Ollama embedding endpoint (`AppSettings::embed_model`, default `nomic-embed-text`,
//! at `AppSettings::ollama_url`) — the same approach as the legacy `search::embed` — and
//! the resulting vectors are written to the JSONL. Search embeds the query and brute-forces
//! cosine similarity over the JSONL (plenty fast at personal scale). Fully local; nothing
//! leaves the machine. Requires Ollama running with the embedding model pulled.

use crate::storage::SettingsManager;
use crate::types::AppSettings;
use crate::vault::Vault;
use crate::vault_cmds::vault_root;
use crate::vault_search::SearchHit;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;

/// Target chunk size in characters. ~512 tokens ≈ ~2000 chars of English prose
/// (rough 1 token ≈ 4 chars heuristic).
const CHUNK_CHARS: usize = 2000;
/// Overlap between consecutive chunks (characters), so a sentence split across a
/// boundary still embeds in context on at least one side.
const CHUNK_OVERLAP: usize = 200;

// ---- on-disk index shapes ----

/// One embedded chunk, serialized as a single JSONL line in `embeddings.jsonl`.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct EmbeddedChunk {
    /// Conversation id (vault-relative path).
    conv: String,
    /// Chunk index within the conversation (0-based).
    chunk: usize,
    /// Character offset of the chunk within the transcript text.
    start: usize,
    /// The chunk text (kept so search can build snippets without re-reading).
    text: String,
    /// Embedding vector.
    vector: Vec<f32>,
}

/// One manifest entry: content hash + mtime of a conversation's source text.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestEntry {
    hash: String,
    #[serde(default)]
    mtime: String,
}

type Manifest = HashMap<String, ManifestEntry>;

// ---- paths ----

fn index_dir() -> PathBuf {
    vault_root().join(".memosa").join("index")
}

fn embeddings_path() -> PathBuf {
    index_dir().join("embeddings.jsonl")
}

fn manifest_path() -> PathBuf {
    index_dir().join("manifest.json")
}

// ---- math + chunking ----

/// Cosine similarity of two equal-length vectors. Returns 0.0 on length mismatch
/// or zero-norm input.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Chunk text into ~CHUNK_CHARS windows with CHUNK_OVERLAP overlap, preferring to
/// break on paragraph/sentence boundaries. Returns `(start_offset, text)` pairs.
/// Offsets are byte offsets into `text`, always on char boundaries.
fn chunk_text(text: &str) -> Vec<(usize, String)> {
    let mut chunks = Vec::new();
    if text.trim().is_empty() {
        return chunks;
    }
    let bytes = text.len();
    let mut start = 0usize;
    while start < bytes {
        let hard_end = (start + CHUNK_CHARS).min(bytes);
        let end = if hard_end >= bytes {
            bytes
        } else {
            // Prefer a paragraph/sentence/space boundary within the last quarter.
            let window_lo = start + (CHUNK_CHARS * 3 / 4);
            best_break(text, window_lo.min(hard_end), hard_end)
        };
        let end = ceil_char_boundary(text, end);
        let piece = text[ceil_char_boundary(text, start)..end].trim();
        if !piece.is_empty() {
            chunks.push((ceil_char_boundary(text, start), piece.to_string()));
        }
        if end >= bytes {
            break;
        }
        // Advance with overlap, but always make forward progress.
        let next = end.saturating_sub(CHUNK_OVERLAP);
        start = if next <= start { end } else { next };
    }
    chunks
}

/// Find a good break point (newline > period > space) scanning backward from `hi`
/// down to `lo`; falls back to `hi` if none found.
fn best_break(text: &str, lo: usize, hi: usize) -> usize {
    let lo = floor_char_boundary(text, lo);
    let hi = floor_char_boundary(text, hi);
    let slice = &text[lo..hi];
    if let Some(i) = slice.rfind('\n') {
        return lo + i + 1;
    }
    if let Some(i) = slice.rfind(". ") {
        return lo + i + 2;
    }
    if let Some(i) = slice.rfind(' ') {
        return lo + i + 1;
    }
    hi
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

// ---- embedding (reuses the search/mod.rs Ollama approach) ----

/// Embed text via the local Ollama embedding endpoint. Identical protocol to the
/// legacy `search::embed` so the index is interchangeable.
async fn embed(settings: &AppSettings, text: &str) -> Result<Vec<f32>, String> {
    let url = format!("{}/api/embeddings", settings.ollama_url.trim_end_matches('/'));
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&json!({ "model": settings.embed_model, "prompt": text }))
        .send()
        .await
        .map_err(|e| format!("Ollama embeddings request failed (is Ollama running?): {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Ollama embeddings returned {}. Pull the model first: `ollama pull {}`.",
            resp.status(),
            settings.embed_model
        ));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let arr = body
        .get("embedding")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Ollama response had no embedding array".to_string())?;
    Ok(arr.iter().filter_map(|v| v.as_f64().map(|f| f as f32)).collect())
}

// ---- source text + hashing ----

/// The text we index for a conversation: transcript plaintext plus notes markdown.
/// Empty string when neither exists.
fn source_text(v: &Vault, conv: &str) -> String {
    let mut out = String::new();
    if let Ok(t) = v.transcript(conv) {
        if !t.segments.is_empty() {
            out.push_str(&t.to_plaintext());
        }
    }
    if let Ok(n) = v.notes(conv) {
        if !n.markdown.trim().is_empty() {
            if !out.is_empty() {
                out.push_str("\n\n");
            }
            out.push_str(&n.markdown);
        }
    }
    out
}

fn hash_text(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    format!("{:x}", h.finalize())
}

// ---- index io ----

fn read_manifest() -> Manifest {
    match std::fs::read_to_string(manifest_path()) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Manifest::new(),
    }
}

fn write_manifest(m: &Manifest) -> Result<(), String> {
    ensure_index_dir()?;
    let json = serde_json::to_string_pretty(m).map_err(|e| e.to_string())?;
    atomic_write(&manifest_path(), json.as_bytes())
}

fn read_embeddings() -> Vec<EmbeddedChunk> {
    let raw = match std::fs::read_to_string(embeddings_path()) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<EmbeddedChunk>(l).ok())
        .collect()
}

fn write_embeddings(rows: &[EmbeddedChunk]) -> Result<(), String> {
    ensure_index_dir()?;
    let mut buf = String::new();
    for r in rows {
        let line = serde_json::to_string(r).map_err(|e| e.to_string())?;
        buf.push_str(&line);
        buf.push('\n');
    }
    atomic_write(&embeddings_path(), buf.as_bytes())
}

fn ensure_index_dir() -> Result<(), String> {
    std::fs::create_dir_all(index_dir()).map_err(|e| e.to_string())
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// ---- conversation enumeration ----

fn all_convs(v: &Vault) -> Vec<String> {
    let mut convs = Vec::new();
    if let Ok(tree) = v.tree() {
        collect_convs(&tree, &mut convs);
    }
    convs
}

fn collect_convs(node: &crate::vault::TreeNode, out: &mut Vec<String>) {
    match node.kind {
        crate::vault::NodeKind::Conversation => out.push(node.path.clone()),
        _ => {
            for child in &node.children {
                collect_convs(child, out);
            }
        }
    }
}

// ---- indexing ----

/// Incrementally (re)build the embeddings index. Re-embeds only conversations whose
/// source text hash changed since the last run, drops embeddings for conversations
/// that no longer exist, and leaves unchanged ones untouched. Returns the total
/// number of chunks in the index afterward. Requires Ollama + the embedding model.
///
/// `force` rebuilds everything from scratch (used by `rebuild`).
pub async fn reindex(force: bool) -> Result<usize, String> {
    let v = Vault::new(vault_root());
    v.ensure().map_err(|e| e.to_string())?;
    let settings = SettingsManager::load();

    let convs = all_convs(&v);
    let conv_set: std::collections::HashSet<&str> = convs.iter().map(|s| s.as_str()).collect();

    let mut manifest = if force { Manifest::new() } else { read_manifest() };
    let existing = if force { Vec::new() } else { read_embeddings() };

    // Bucket existing rows by conv so we can keep the unchanged ones verbatim.
    let mut by_conv: HashMap<String, Vec<EmbeddedChunk>> = HashMap::new();
    for row in existing {
        by_conv.entry(row.conv.clone()).or_default().push(row);
    }

    // Drop manifest + embeddings for conversations that no longer exist.
    by_conv.retain(|c, _| conv_set.contains(c.as_str()));
    manifest.retain(|c, _| conv_set.contains(c.as_str()));

    for conv in &convs {
        let text = source_text(&v, conv);
        if text.trim().is_empty() {
            by_conv.remove(conv);
            manifest.remove(conv);
            continue;
        }
        let hash = hash_text(&text);
        let unchanged = manifest.get(conv).map(|e| e.hash == hash).unwrap_or(false)
            && by_conv.contains_key(conv);
        if unchanged {
            continue;
        }

        // Re-embed this conversation.
        let mut rows = Vec::new();
        for (idx, (start, chunk)) in chunk_text(&text).into_iter().enumerate() {
            let vector = embed(&settings, &chunk).await?;
            rows.push(EmbeddedChunk {
                conv: conv.clone(),
                chunk: idx,
                start,
                text: chunk,
                vector,
            });
        }
        if rows.is_empty() {
            by_conv.remove(conv);
            manifest.remove(conv);
            continue;
        }
        by_conv.insert(conv.clone(), rows);
        manifest.insert(
            conv.clone(),
            ManifestEntry {
                hash,
                mtime: now_iso(),
            },
        );
    }

    // Flatten back to a stable JSONL ordering (by conv, then chunk).
    let mut all: Vec<EmbeddedChunk> = by_conv.into_values().flatten().collect();
    all.sort_by(|a, b| a.conv.cmp(&b.conv).then(a.chunk.cmp(&b.chunk)));
    let total = all.len();
    write_embeddings(&all)?;
    write_manifest(&manifest)?;
    Ok(total)
}

/// Re-embed only the given conversations (e.g. on a `vault_changed` event), leaving
/// the rest of the index intact. Pass the conv ids that changed.
pub async fn reindex_changed(changed: &[String]) -> Result<usize, String> {
    if changed.is_empty() {
        return Ok(read_embeddings().len());
    }
    let v = Vault::new(vault_root());
    v.ensure().map_err(|e| e.to_string())?;
    let settings = SettingsManager::load();

    let mut manifest = read_manifest();
    let mut by_conv: HashMap<String, Vec<EmbeddedChunk>> = HashMap::new();
    for row in read_embeddings() {
        by_conv.entry(row.conv.clone()).or_default().push(row);
    }

    for conv in changed {
        let text = source_text(&v, conv);
        if text.trim().is_empty() {
            by_conv.remove(conv);
            manifest.remove(conv);
            continue;
        }
        let hash = hash_text(&text);
        let mut rows = Vec::new();
        for (idx, (start, chunk)) in chunk_text(&text).into_iter().enumerate() {
            let vector = embed(&settings, &chunk).await?;
            rows.push(EmbeddedChunk {
                conv: conv.clone(),
                chunk: idx,
                start,
                text: chunk,
                vector,
            });
        }
        if rows.is_empty() {
            by_conv.remove(conv);
            manifest.remove(conv);
            continue;
        }
        by_conv.insert(conv.clone(), rows);
        manifest.insert(conv.clone(), ManifestEntry { hash, mtime: now_iso() });
    }

    let mut all: Vec<EmbeddedChunk> = by_conv.into_values().flatten().collect();
    all.sort_by(|a, b| a.conv.cmp(&b.conv).then(a.chunk.cmp(&b.chunk)));
    let total = all.len();
    write_embeddings(&all)?;
    write_manifest(&manifest)?;
    Ok(total)
}

// ---- semantic query ----

/// Embed `q` and return the top-`k` most similar chunks as [`SearchHit`]s, brute-forcing
/// cosine over `embeddings.jsonl`. `scope` is a vault sub-path prefix filter (e.g.
/// `Life/Dad`). One hit per conversation (the best-scoring chunk), so callers get a
/// de-duplicated, conversation-level result set. Requires Ollama for the query embedding.
pub async fn semantic_search(
    q: &str,
    scope: Option<&str>,
    k: usize,
) -> Result<Vec<SearchHit>, String> {
    let query = q.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let rows = read_embeddings();
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let settings = SettingsManager::load();
    let qv = embed(&settings, query).await?;

    let scope_prefix = scope.map(|s| s.trim().trim_matches('/').to_lowercase());
    let v = Vault::new(vault_root());

    // Best chunk per conversation.
    let mut best: HashMap<String, (f32, EmbeddedChunk)> = HashMap::new();
    for row in rows {
        if let Some(prefix) = &scope_prefix {
            if !in_scope(&row.conv, prefix) {
                continue;
            }
        }
        let score = cosine(&qv, &row.vector);
        match best.get(&row.conv) {
            Some((s, _)) if *s >= score => {}
            _ => {
                best.insert(row.conv.clone(), (score, row));
            }
        }
    }

    let mut scored: Vec<(f32, EmbeddedChunk)> = best.into_values().collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);

    let hits = scored
        .into_iter()
        .map(|(score, row)| {
            let (title, date) = match v.read_meta(&row.conv) {
                Ok(m) => (m.title, m.created),
                Err(_) => (
                    row.conv.rsplit('/').next().unwrap_or(&row.conv).to_string(),
                    String::new(),
                ),
            };
            SearchHit {
                conv: row.conv.clone(),
                title,
                path: format!("{}/transcript.txt", row.conv),
                snippet: snippet_of(&row.text),
                score,
                date,
            }
        })
        .collect();
    Ok(hits)
}

/// Is `conv` under the (already-normalized, lowercase) scope `prefix`?
fn in_scope(conv: &str, prefix: &str) -> bool {
    if prefix.is_empty() {
        return true;
    }
    let c = conv.to_lowercase();
    c == *prefix || c.starts_with(&format!("{}/", prefix))
}

/// Collapse whitespace and cap a chunk into a one-line snippet for the UI.
fn snippet_of(text: &str) -> String {
    let one_line: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let max = 220usize;
    if one_line.len() <= max {
        one_line
    } else {
        let mut end = max;
        while end > 0 && !one_line.is_char_boundary(end) {
            end -= 1;
        }
        format!("{} …", &one_line[..end])
    }
}

// ---- status ----

/// Index status for the Settings UI.
#[derive(Serialize)]
pub struct IndexStatus {
    /// Number of embedded chunks currently in the index.
    pub chunks: usize,
    /// Number of conversations whose source text changed (or were never indexed)
    /// since the last reindex — i.e. how many would be re-embedded next run.
    pub stale: usize,
    /// Total conversations with indexable text in the vault.
    pub conversations: usize,
}

fn compute_status() -> IndexStatus {
    let v = Vault::new(vault_root());
    let manifest = read_manifest();
    let chunks = read_embeddings().len();

    let mut stale = 0usize;
    let mut conversations = 0usize;
    for conv in all_convs(&v) {
        let text = source_text(&v, &conv);
        if text.trim().is_empty() {
            continue;
        }
        conversations += 1;
        let hash = hash_text(&text);
        let fresh = manifest.get(&conv).map(|e| e.hash == hash).unwrap_or(false);
        if !fresh {
            stale += 1;
        }
    }
    IndexStatus {
        chunks,
        stale,
        conversations,
    }
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ---- Tauri commands ----

/// Rebuild/refresh the semantic index. Incremental by default (only changed
/// conversations are re-embedded). Returns the resulting chunk count.
#[tauri::command]
pub async fn vault_reindex() -> Result<usize, String> {
    reindex(false).await
}

/// Wipe and fully rebuild the semantic index. Returns the resulting chunk count.
#[tauri::command]
pub async fn vault_reindex_all() -> Result<usize, String> {
    reindex(true).await
}

/// Index status: how many chunks are indexed and how many conversations are stale.
#[tauri::command]
pub async fn vault_embedding_status() -> Result<IndexStatus, String> {
    Ok(compute_status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_basics() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), 0.0); // length mismatch
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 1.0]), 0.0); // zero norm
    }

    #[test]
    fn chunking_splits_overlaps_and_covers() {
        let para = "word ".repeat(2000); // ~10000 chars
        let chunks = chunk_text(&para);
        assert!(chunks.len() >= 4, "long text should split into several chunks");
        assert!(chunks.iter().all(|(_, c)| !c.trim().is_empty()));
        // Offsets must be strictly increasing.
        for w in chunks.windows(2) {
            assert!(w[1].0 > w[0].0, "chunk offsets must advance");
        }
    }

    #[test]
    fn chunking_short_text_single_chunk() {
        let chunks = chunk_text("just a short note");
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].0, 0);
    }

    #[test]
    fn hash_is_stable_and_sensitive() {
        assert_eq!(hash_text("abc"), hash_text("abc"));
        assert_ne!(hash_text("abc"), hash_text("abd"));
    }

    #[test]
    fn scope_matching() {
        assert!(in_scope("Life/Dad/2026-06-17-x", "life/dad"));
        assert!(!in_scope("Life/Dadson/x", "life/dad"));
        assert!(in_scope("anything", ""));
    }
}
