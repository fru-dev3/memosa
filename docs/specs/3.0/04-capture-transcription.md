# 04 — Capture & Transcription

Audio in → `audio.m4a` + `transcript.json` on disk. Local only. Depends on **01**, **02**.

## Capture
- Record system + mic audio to a temp WAV, then encode `audio.m4a` into the conversation dir.
  (Reuse existing macOS AVFoundation path; cross-platform encode via the existing approach.)
- `capture_start(folder,title)` creates the conversation folder (via vault core) + begins
  recording; emits `capture_progress {seconds, level}` for the live UI.
- Pause/resume/stop. On stop: finalize audio, kick transcription, return ConvId.
- Import: `import_audio(src,folder)` copies/encodes then transcribes the same way.

## Transcription (whisper.cpp, local)
- Decode audio → 16 kHz mono f32 (reuse `audioconv` — already built for cross-platform;
  macOS uses AVFoundation). Run whisper.cpp with the configured model (spec 05).
- Produce `transcript.json` (segments with start/end/text), then derived `transcript.txt`.
- **Live transcription:** stream partial segments during capture → `transcript_partial` events
  for the capture overlay; final pass on stop replaces partials.

## Diarization (foundation now, engine later)
- Data model already exists (speaker segments). Assign `speaker` labels S1/S2… in segments;
  map to names in `transcript.json.speakers`. Acoustic engine (sherpa-onnx) is a later swap
  behind the same interface — do not block 3.0 on it; default single-speaker / heuristic.

## After transcription
- Trigger summary (spec 05) → writes `notes.md`; trigger incremental index (spec 03).

## Acceptance
Record 30s of speech → conversation folder contains a playable `audio.m4a`, a
`transcript.json` with timestamped segments, and `transcript.txt`. No network calls.
