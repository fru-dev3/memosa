# Changelog

All notable changes to Memosa. Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

---

## [Unreleased]

### Added

- **Open source.** Memosa is now open source under the GPL-3.0 license, with a
  direct-download `.dmg` (Developer ID signed & notarized) alongside the Mac App
  Store build.

## [1.0.2] — Mac App Store release

The shipping App Store build, plus on-device feature work since:

### Added

- **AI summaries, action items & decisions** — local-first via the built-in
  heuristic or a local Ollama model (private by default), or your own
  Anthropic/OpenAI key (opt-in BYOK). "Regenerate all" re-runs insights across
  your library.
- **Chat with your meetings** — ask questions across your transcript library
  (local FTS retrieval + your chosen engine).
- **Calendar auto-record** — connect Google Calendar (read-only) to record
  meetings automatically, with a 2-minute heads-up.
- **AI speaker labels** — speaker-attributed transcript on demand.
- **Sync** a meeting to an Obsidian vault (local) or a Notion database (your token).

### Core

- Records meetings and calls on your Mac; transcribes locally with Whisper
  (on-device after the initial model download).
- Organises recordings by date, tags, people, and custom folders; SQLite FTS5
  full-text search.
- Exports transcripts and notes to any folder or tool.
