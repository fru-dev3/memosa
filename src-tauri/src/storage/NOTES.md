# Storage Module — Notes for Agent 6 (Integration)

## Cargo.toml additions needed

Add these dependencies to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
rusqlite = { version = "0.31", features = ["bundled", "vtab"] }
dirs = "5"
```

The following are already present in the scaffold Cargo.toml and do NOT need to be added again:

```toml
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
serde_json = "1"
```

## lib.rs additions needed

The integration point is `src-tauri/src/lib.rs` (not main.rs — the scaffold uses lib.rs).

### 1. Declare the storage module at the top of lib.rs

```rust
pub mod storage;
```

### 2. Register the Database as managed Tauri state (before .invoke_handler)

```rust
.manage(storage::db::Database::new().expect("Failed to open database"))
```

### 3. Replace the mock storage commands in `invoke_handler` with the real ones

Remove:
```rust
commands_mock::get_meetings,
commands_mock::get_meeting,
commands_mock::search_meetings,
commands_mock::delete_meeting,
commands_mock::get_storage_path,
commands_mock::set_storage_path,
commands_mock::get_settings,
commands_mock::save_settings,
commands_mock::open_meeting_folder,
```

Add:
```rust
storage::get_meetings,
storage::get_meeting,
storage::search_meetings,
storage::delete_meeting,
storage::get_storage_path,
storage::set_storage_path,
storage::get_settings,
storage::save_settings,
storage::open_meeting_folder,
```

### IMPORTANT: delete_meeting signature difference

The real `storage::delete_meeting` takes an extra `app_handle: tauri::AppHandle` parameter
(to emit the `meeting-deleted` event). The mock version does not. This is intentional and
correct — Tauri injects AppHandle automatically when the command is registered.

The TypeScript call signature is unchanged: `invoke('delete_meeting', { id })` — no action
needed on the frontend.

## Assumptions

- Database is created at `~/.memosa/memosa.db` on first run (directory created automatically).
- Settings are written to `~/.memosa/settings.json` on first `save_settings` call; `load()` falls back to defaults if the file is absent.
- Meeting folders are created under `settings.storage_path` (default `~/Documents/Memosa/`).
- FTS5 index is populated after transcription completes — Agent 2 should call `storage::index_transcript(meeting_id, &db)` from its transcription completion handler.
- `delete_meeting` permanently removes both the DB record and the on-disk folder — there is no undo.
- WAL journal mode is enabled on the SQLite connection for better read concurrency.

## Cross-module public functions

These Rust functions are `pub` for direct use by other modules (not exposed as Tauri commands):

| Function | Signature | Used by |
|---|---|---|
| `storage::create_meeting_record` | `(title, calendar_event_id, attendees, settings, db) -> Result<(String, PathBuf), String>` | Agent 1 (audio recorder) |
| `storage::index_transcript` | `(meeting_id, db) -> Result<(), String>` | Agent 2 (transcription) |
| `storage::db::Database::update_transcription_status` | `(meeting_id, status, transcript_path) -> Result<(), String>` | Agent 2 (transcription) |
| `storage::db::Database::update_duration` | `(meeting_id, duration_seconds) -> Result<(), String>` | Agent 1 (audio recorder) |
| `storage::fs::write_metadata` / `update_metadata` | see fs.rs | Any agent needing to update metadata.json |
| `storage::fs::scan_all_meetings` | `(root) -> Vec<PathBuf>` | DB rebuild/sync utility |

## File layout enforced by this module

```
~/Documents/Memosa/          <- configurable via storage_path setting
  {YYYY}/
    {MM}-{MonthName}/        e.g. "03-March"
      {YYYY-MM-DD}_{HHMM}_{Sanitized-Title}/
        audio.m4a
        transcript.md        (written by Agent 2 after transcription)
        metadata.json        (written by this module at meeting creation)

~/.memosa/
  memosa.db                  <- SQLite database (WAL mode)
  settings.json              <- App settings JSON
  models/                    <- Whisper model files (managed by Agent 2)
```
