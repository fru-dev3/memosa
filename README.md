# Memosa

Local-first meeting recorder for macOS. Records audio, transcribes on-device using Whisper, and organises everything into a searchable library — nothing leaves your machine unless you choose.

## What it does

- Records meetings and calls on your Mac
- Transcribes audio locally using Whisper (on-device after initial model download)
- Organises recordings by date, tags, people, and custom folders
- Summarises and extracts key points, action items, and decisions
- Exports transcripts and notes to any folder or tool you already use

## Tech stack

- **Frontend** — React + TypeScript + Vite
- **Backend** — Rust via Tauri 2
- **Transcription** — whisper-rs (on-device)
- **Storage** — SQLite (FTS5 full-text search) + local file system
- **Audio** — CoreAudio via Objective-C (no subprocess, MAS sandbox compliant)

## Requirements

- macOS 13.0 or later
- Rust (latest stable)
- Node.js 18+

## Development

```bash
# Install dependencies
npm install

# Start dev server (Vite only — see note below)
npx vite

# Build Rust binary
cd src-tauri && cargo build --no-default-features --features whisper-rs

# For microphone access in dev, wrap in a signed .app bundle
# See: src-tauri/src/audio/permissions.rs
```

> **Note on mic permissions in dev:** macOS requires a signed `.app` bundle to show
> the microphone permission dialog. Running the binary directly will silently deny access.
> Build the bundle and launch via `open` to trigger the TCC prompt.

## Release build

```bash
npm run tauri build
# Output: target/release/bundle/macos/Memosa.app
```

## Project structure

```
src/                    React frontend
src-tauri/src/          Rust backend
  audio/                Recording, mic permissions, CoreAudio helpers
  transcription/        Whisper integration and job queue
  storage/              SQLite DB, file system, settings, cleanup
  export/               Export providers (local bundle)
  macos.rs              ObjC bridge (audio, URL open, Finder reveal)
  macos_helpers.m       Objective-C implementations
src-tauri/entitlements.plist   App sandbox entitlements
src-tauri/Info.plist           macOS metadata and privacy strings
```

## Privacy

All audio and transcripts are stored locally at the path you configure in Settings.
Whisper models are downloaded from the internet on first use, then all processing runs on-device.
The app is sandboxed and targets the Mac App Store.

## License

Copyright © 2026 Ben. All rights reserved.
