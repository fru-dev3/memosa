# Transcription Module — Notes for Agent 6

## Cargo.toml additions required

Add the following to `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
reqwest      = { version = "0.12", features = ["json", "stream"] }
futures-util = "0.3"
dirs         = "5"
```

### whisper-rs (optional but preferred)

`whisper-rs` has complex native build requirements (whisper.cpp must be
compiled from source). It is **not** added to Cargo.toml by default to avoid
breaking the initial build. Two strategies are available:

**Strategy A — whisper-rs (recommended for production):**

1. Add to `Cargo.toml`:
   ```toml
   whisper-rs = { version = "0.11", optional = true }
   ```
2. Add a feature flag:
   ```toml
   [features]
   whisper-rs = ["dep:whisper-rs"]
   ```
3. Build with:
   ```sh
   WHISPER_METAL=1 cargo build --features whisper-rs
   ```
4. On Apple Silicon, set `WHISPER_METAL=1` to enable Metal GPU acceleration.
5. May also require `cmake` and `clang` installed (`brew install cmake llvm`).

**Strategy B — whisper CLI fallback (default, zero extra build deps):**

The module automatically falls back to the `whisper` Python CLI when the
`whisper-rs` feature is not enabled. Install with:

```sh
pip install openai-whisper
brew install ffmpeg
```

The CLI fallback shells out to:
```
whisper <audio> --model <name> --output_format srt --output_dir <tmp>
```
and parses the resulting SRT file for timestamped segments.

---

## main.rs / lib.rs additions required

### 1. Declare the module (add to both `main.rs` and `lib.rs`)

```rust
mod transcription;
```

### 2. Add managed state (in the `tauri::Builder` chain)

```rust
.manage(transcription::TranscriptionManager::new())
```

### 3. Register Tauri commands (in `invoke_handler`)

```rust
transcription::get_available_models,
transcription::download_model,
transcription::transcribe_audio,
transcription::get_transcription_status,
transcription::cancel_transcription,
```

### 4. Remove (or keep) the corresponding mock commands from `commands_mock`

The following mock commands are superseded and should be removed from
`commands_mock.rs` and the `invoke_handler` once the real module is wired in:

- `commands_mock::get_available_models`
- `commands_mock::download_model`
- `commands_mock::transcribe_audio`
- `commands_mock::get_transcription_status`
- `commands_mock::cancel_transcription`

---

## Runtime requirements

| Requirement  | How to install           |
|--------------|--------------------------|
| ffmpeg       | `brew install ffmpeg`    |
| whisper CLI  | `pip install openai-whisper` (fallback only) |
| cmake / clang| `brew install cmake llvm` (whisper-rs build only) |

---

## Cancellation note

`cancel_job` marks the job as `Cancelled` in the state map. The underlying
`spawn_blocking` thread cannot be interrupted mid-inference, so cancellation
takes effect after the current segment finishes. No further progress or
completion events are emitted once the job is marked cancelled.

---

## Assumptions

- `ffmpeg` is installed and on `$PATH`.
- Model files live at `~/.memosa/models/ggml-{tiny|base|small|medium}.bin`.
- `audio_path` passed to `transcribe_audio` is an absolute path to a file
  readable by ffmpeg (m4a, wav, mp3, etc.).
- `metadata.json` is present in the same folder as the audio file (written by
  Agent 4 / storage module). If absent, title defaults to "Meeting" and
  attendees to "Unknown".
