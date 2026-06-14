# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Email
**security@memosa.dev** (or DM the maintainer) with details and steps to
reproduce. We aim to acknowledge within 72 hours.

## Threat model & design notes

Memosa is local-first; your audio and transcripts never leave your machine
unless you explicitly export or enable an integration. Key considerations:

- **Recordings & transcripts** live on disk at the storage folder you pick in
  Settings. They are **not encrypted at rest** — treat that folder like any
  sensitive documents folder.
- **Secrets** (Google Calendar OAuth token, Notion token, BYOK Anthropic/OpenAI
  keys) are stored in the macOS **Keychain**, never on disk or in localStorage.
- **On-device by default.** Recording and transcription run locally via
  whisper-rs after a one-time Whisper model download. AI insights default to a
  built-in heuristic or a local Ollama model. Cloud options (BYOK summaries,
  Notion sync) only transmit data **after you opt in**, and the UI says so.
- **Calendar** uses a **read-only** Google Calendar scope. The OAuth flow uses
  PKCE with a transient `localhost:8899` loopback redirect; the token lives in
  the Keychain.
- **Sandbox & hardened runtime.** The app is sandboxed (App Store build) and the
  direct-download build is Developer ID signed, notarized, and runs under the
  macOS hardened runtime.
- **Network access** is used only for the first-use Whisper model download and
  for integrations you explicitly enable.

## Supported versions

The latest released version receives security fixes.
