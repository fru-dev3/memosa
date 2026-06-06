# Audio Module — Notes for Agent 6 / main.rs integrator

## What must be added to main.rs (and lib.rs)

Both `src/main.rs` and `src/lib.rs` need the same changes.

### 1. Add the module declaration (top of file, alongside existing `mod types;`)

```rust
mod audio;
```

### 2. Register AudioRecorder as Tauri managed state

In `tauri::Builder::default()` chain, add **before** `.invoke_handler(...)`:

```rust
.manage(audio::recorder::AudioRecorder::new())
```

### 3. Replace the four audio mock commands in invoke_handler

Remove:
```rust
commands_mock::start_recording,
commands_mock::stop_recording,
commands_mock::get_recording_status,
commands_mock::get_input_devices,
```

Add:
```rust
audio::recorder::start_recording,
audio::recorder::stop_recording,
audio::recorder::get_recording_status,
audio::recorder::get_input_devices,
```

The non-audio mock commands (transcription, calendar, storage, etc.) stay
unchanged until their respective agents replace them.

---

## Cargo.toml additions made by this agent

```toml
cpal = "0.15"          # cross-platform audio I/O
hound = "3"            # WAV writing
dirs-next = "2"        # home directory resolution
```

---

## Architecture

```
AudioRecorder (Tauri state, Arc<Mutex<RecorderState>>)
  |
  +-- start() -> spawns OS thread: capture_and_encode()
  |     |
  |     +-- cpal mic stream  ──┐
  |     +-- cpal BlackHole   ──┤  push f32 samples into shared Arc<Mutex<Vec<f32>>>
  |                            |
  |     +-- 100 ms loop:       |
  |           drain PCM buf ◄──┘
  |           mix_streams(mic, bh)   (mixer.rs)
  |           write to temp .tmp.wav (hound)
  |           compute_rms → emit "audio-level"
  |
  +-- stop() -> sets AtomicBool stop_flag, joins thread
        thread: finalises WAV, runs ffmpeg, deletes WAV
        returns (PathBuf, duration_secs)
```

---

## Known limitations / assumptions

1. **ffmpeg must be installed** (`brew install ffmpeg`).  If absent the engine
   falls back to saving a `.wav` file and returns an `Err` string describing
   the fallback location.

2. **BlackHole 2ch** is detected by exact name substring `"BlackHole 2ch"`.
   If the device is named differently (e.g. "BlackHole 16ch") it will not be
   picked up.  Failure to find it is non-fatal; recording continues mic-only.

3. **Sample-rate mismatch**: if BlackHole is running at a different sample rate
   than the microphone, the mixed PCM will be at the mic's native rate and the
   BlackHole samples are mixed as-is (no resampling).  A future improvement
   would add a resampler for the second stream.

4. **Mono/stereo**: the WAV is written with the mic's native channel count.
   BlackHole samples are mixed by simple averaging regardless of channel layout.
   A proper mixer would down/up-mix to a common channel count first.

5. The output path defaults to
   `~/Documents/Memosa/tmp/{meeting_id}_{safe_title}/audio.m4a`.
   The storage agent (Agent 4) should ultimately control this path; for now
   this is a sensible default so recordings are not lost in /tmp.

6. `dirs-next` is used to resolve `~` portably.  If Agent 4 provides a
   `get_storage_path` API at runtime this can be swapped out.
