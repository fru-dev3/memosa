# 03 — Search & Index (file-based, no DB)

Semantic + keyword search and the Ask retrieval layer. Depends on **01**, **05** (embeddings).

## Storage
- Embeddings: `.memosa/index/embeddings.jsonl` — one `{conv,chunk,start,text,vector}` per line.
- Change detection: `.memosa/index/manifest.json` = `{ "<conv>/transcript.json": {hash,mtime} }`.
- Tasks index: `.memosa/index/tasks.jsonl` (derived from notes.md, rebuilt on notes write).
- Everything rebuildable from the vault; deleting `.memosa/index/` loses nothing permanent.

## Indexing
- Chunk transcripts (~512 tokens, overlap) → embed via local model (spec 05) → append JSONL.
- Incremental: on `vault_changed`, diff manifest hash; re-embed only changed conversations.
- `index_rebuild()` wipes and re-embeds all; `index_status()` returns counts + stale.

## Query
- **Semantic:** embed query → brute-force cosine over embeddings.jsonl (fine for personal
  scale, tens of thousands of chunks). Return top-k with conv + snippet + score.
- **Exact:** case-insensitive substring / token match over transcript.txt + notes.md.
- **Hybrid (default for Ask):** union of semantic top-k and exact hits, de-duped per conv,
  re-ranked. Scope filter = a vault sub-path prefix (e.g. `Life/Dad`).
- Snippet = best matching window with the query terms highlighted (return offsets).

## API (Rust)
```rust
fn search(q:&str, mode:Mode, scope:Option<&str>) -> Vec<SearchHit>;
fn retrieve(q:&str, scope:Option<&str>, k:usize) -> Vec<Chunk>;   // feeds Ask (05)
fn reindex_changed(changed:&[String]) -> Result<()>;
fn rebuild() -> Result<()>;
fn tasks(filter:TaskFilter) -> Vec<Task>;
```

## Acceptance
Query "water damage coverage" semantically surfaces a conversation that says "flood damage"
with no shared keywords; exact mode does not. Index survives app restart (it's just files).
