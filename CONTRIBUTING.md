# Contributing to Memosa

Thanks for your interest! Memosa is a **local-first** meeting recorder for macOS —
a Tauri 2 + React desktop app that records audio, transcribes on-device with
Whisper, and keeps everything on your machine unless you choose otherwise.

## Prerequisites

- **Node 18+** (20 recommended) and **npm**
- **Rust** (stable) + the Xcode Command Line Tools
- macOS 13.0 or later (Apple Silicon)

## Run it

```bash
npm install
npx vite                 # frontend dev server
```

> **Mic permissions in dev:** macOS only shows the microphone prompt to a signed
> `.app` bundle. Running the binary directly silently denies access — build the
> bundle and launch it via `open`. See `src-tauri/src/audio/permissions.rs`.

## Before you push

```bash
npx tsc --noEmit                                   # frontend typecheck
npm run build                                      # frontend production build
cd src-tauri && cargo test && cargo clippy         # backend
```

CI runs the same checks (`.github/workflows/test.yml`). Keep them green.

## Conventions

- **Conventional commits** (`feat(audio): …`, `fix(transcription): …`).
- **No emojis in UI** — use geometric marks (◆ ◇ ● ○ ✓ ✗ ▸) where you'd reach for one.
- **Local-first by default.** Any code path that sends data off the machine
  (cloud insight provider, Notion, calendar) must be opt-in and clearly labelled
  in the UI. Secrets live in the macOS **Keychain**, never on disk or in localStorage.
- New on-disk formats (DB schema, metadata) get a Rust round-trip test.

## Project layout

See the **Project structure** section of the [README](README.md). The Rust
backend lives in `src-tauri/src/` (audio, transcription, insights, calendar,
chat, sync, storage, export); the React frontend in `src/`.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md) — please disclose privately.
