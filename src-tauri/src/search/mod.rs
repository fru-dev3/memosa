//! Local semantic search over the meeting corpus.
//!
//! Transcripts are chunked, each chunk embedded via the local Ollama embedding
//! model (`AppSettings::embed_model`, default `nomic-embed-text`), and stored in
//! the `embeddings` table as little-endian f32 bytes. Search embeds the query and
//! ranks chunks by cosine similarity in Rust (brute force is plenty for a personal
//! corpus). Fully local — nothing leaves the machine. Falls back gracefully to
//! FTS when no embedding index / Ollama is available.

use crate::storage::{Database, SettingsManager};
use crate::types::AppSettings;
use serde::Serialize;
use serde_json::json;

/// Target chunk size in characters (roughly a few sentences / a short paragraph).
const CHUNK_CHARS: usize = 900;

#[derive(Serialize, Clone, Debug)]
pub struct SemanticHit {
    pub meeting_id: String,
    pub text: String,
    pub score: f32,
}

/// Cosine similarity of two equal-length vectors. Returns 0.0 on length
/// mismatch or zero-norm input.
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

/// Split a transcript into ~CHUNK_CHARS chunks on paragraph/line boundaries.
pub fn chunk_transcript(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for para in text.split("\n\n") {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }
        if current.len() + para.len() + 2 > CHUNK_CHARS && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(para);
        // A single huge paragraph: hard-split it.
        while current.len() > CHUNK_CHARS * 2 {
            let split = current
                .char_indices()
                .take_while(|(i, _)| *i < CHUNK_CHARS)
                .last()
                .map(|(i, c)| i + c.len_utf8())
                .unwrap_or(current.len());
            let rest = current.split_off(split);
            chunks.push(std::mem::take(&mut current));
            current = rest;
        }
    }
    if !current.trim().is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Embed text via the local Ollama embedding endpoint.
pub async fn embed(settings: &AppSettings, text: &str) -> Result<Vec<f32>, String> {
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

/// (Re)build the semantic index across the whole library. Returns the number of
/// chunks indexed. Requires Ollama + the embedding model. Callable from the
/// Tauri command and the `memosa reindex` CLI path.
pub async fn reindex_all(db: &Database) -> Result<usize, String> {
    let settings = SettingsManager::load();
    let meetings = db.meetings_with_transcripts()?;
    let mut total = 0usize;
    for (id, path) in meetings {
        let transcript = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let chunks = chunk_transcript(&transcript);
        if chunks.is_empty() {
            continue;
        }
        db.clear_meeting_embeddings(&id)?;
        for (idx, chunk) in chunks.iter().enumerate() {
            let vec = embed(&settings, chunk).await?;
            db.store_embedding(&id, idx as i64, chunk, &vec)?;
            total += 1;
        }
    }
    Ok(total)
}

#[tauri::command]
pub async fn rebuild_embeddings(db: tauri::State<'_, Database>) -> Result<usize, String> {
    reindex_all(&db).await
}

/// Embed `query` and return the top-`limit` most similar transcript chunks.
pub async fn semantic_search(
    db: &Database,
    query: &str,
    limit: usize,
) -> Result<Vec<SemanticHit>, String> {
    let settings = SettingsManager::load();
    let qv = embed(&settings, query).await?;
    let mut scored: Vec<SemanticHit> = db
        .load_all_embeddings()?
        .into_iter()
        .map(|(meeting_id, text, vec)| SemanticHit {
            score: cosine(&qv, &vec),
            meeting_id,
            text,
        })
        .collect();
    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);
    Ok(scored)
}

/// Command wrapper for the UI / direct use.
#[tauri::command]
pub async fn semantic_search_meetings(
    query: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<SemanticHit>, String> {
    if query.trim().is_empty() {
        return Err("Enter a query.".into());
    }
    semantic_search(&db, query.trim(), 10).await
}

/// Status for the Settings UI: how many chunks are indexed.
#[tauri::command]
pub async fn embedding_status(db: tauri::State<'_, Database>) -> Result<i64, String> {
    db.embedding_count()
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
    fn embedding_blob_roundtrips_and_ranks() {
        // Mirror the exact encode (db.rs store_embedding) / decode (load + mcp).
        let v: Vec<f32> = vec![0.1, -0.2, 0.35, 1.0];
        let bytes: Vec<u8> = v.iter().flat_map(|f| f.to_le_bytes()).collect();
        let back: Vec<f32> = bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        assert_eq!(v, back, "f32<->LE-bytes round-trip must be lossless");

        // Ranking: query closest to v1 should outscore v2.
        let q = vec![1.0, 0.0, 0.0];
        let v1 = vec![0.9, 0.1, 0.0];
        let v2 = vec![0.0, 1.0, 0.0];
        assert!(cosine(&q, &v1) > cosine(&q, &v2));
    }

    #[test]
    fn chunking_splits_and_keeps_content() {
        let para = "word ".repeat(300); // ~1500 chars, one paragraph
        let text = format!("{para}\n\n{para}");
        let chunks = chunk_transcript(&text);
        assert!(chunks.len() >= 2, "long text should split into multiple chunks");
        assert!(chunks.iter().all(|c| !c.trim().is_empty()));
    }
}
