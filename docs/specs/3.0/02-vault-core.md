# 02 — Vault Core (Rust)

The only module that touches the vault filesystem. Everything else calls it. Depends on **01**.

## Responsibilities
- Resolve & validate the vault root (`~/Documents/fru/vault/memosa`, configurable).
- Walk the tree → `TreeNode` (domains/folders/conversations) with counts. Cache + invalidate
  on file-watch events. Skip `.memosa/` and dotfiles.
- Read/write `meta.json`, `transcript.json`, `transcript.txt`, `notes.md` per spec 01.
- Folder ops as filesystem ops: create folder = `mkdir`; move conversation = `rename` dir;
  rename = retitle + re-slug dir; delete = move to `.memosa/trash/`.
- Parse `notes.md` ↔ structured `Notes` (front-matter + sections + GFM checkboxes w/ comment
  metadata). Writing a task toggle rewrites only the relevant line, preserving the rest.
- **Atomic writes** (tmp+rename+fsync) and a debounced **file watcher** (`notify` crate) that
  emits `vault_changed` so external edits (or git pulls) reflect live.

## Public API (Rust)
```rust
pub struct Vault { root: PathBuf }
impl Vault {
  fn tree(&self) -> Result<TreeNode>;
  fn list(&self, folder:&str) -> Result<Vec<ConvMeta>>;
  fn get(&self, id:&str) -> Result<(ConvMeta, Notes)>;
  fn transcript(&self, id:&str) -> Result<Transcript>;
  fn create_conversation(&self, folder:&str, meta:ConvMeta) -> Result<String>; // returns id
  fn write_transcript(&self, id:&str, t:&Transcript) -> Result<()>;            // also writes .txt
  fn write_notes(&self, id:&str, n:&Notes) -> Result<()>;
  fn create_folder(&self, path:&str) -> Result<()>;
  fn move_conv(&self, id:&str, dest:&str) -> Result<String>;
  fn rename(&self, id:&str, title:&str) -> Result<String>;
  fn delete(&self, id:&str) -> Result<()>;
  fn set_tags(&self, id:&str, tags:&[String]) -> Result<()>;
  fn toggle_task(&self, id:&str, text:&str, done:bool) -> Result<()>;
  fn watch(&self, on_change: impl Fn(String)) -> Result<Watcher>;
}
```

## Notes
- One source file `src-tauri/src/vault/` (mod.rs, fs.rs, notes.rs, watch.rs).
- Pure-Rust, cross-platform (no macOS-only calls); audio file is written by spec 04, vault
  just records the `audio` filename in meta.
- No caching layer that can diverge from disk — cache is a derived view, disk wins.

## Acceptance
Round-trip property test: create → read → move → rename → toggle task → re-read yields the
expected files; external edit to `notes.md` is picked up via the watcher.
