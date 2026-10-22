# Changelog

All notable changes to Memosa. Format: [Keep a Changelog](https://keepachangelog.com/). Versioning: [SemVer](https://semver.org/).

---

## [Unreleased]

## [1.0.3] - Memosa 3.0: the memory vault

### Added

- **The vault.** Every conversation is a plain folder of files (audio,
  `transcript.json`, `notes.md`, `meta.json`) inside domains and folders you
  create. The default vault is `~/Documents/Memosa Vault`; choose any folder
  in Settings. No database.
- **New interface**: Library with a folder tree, Ask your memory with cited
  sources, Search by meaning or exact phrase, Tasks gathered from every
  conversation, a command palette (Cmd+K), Capture (Cmd+R), and Auto,
  Daylight and Vault themes.
- **Conversation actions**: rename, move to another folder, move to the vault
  trash, transcribe again, summarize, copy as Markdown, show in Finder.
- **Import audio** from a file, and bring recordings over from earlier
  versions. Recordings made in the app are filed into the vault and
  transcribed and summarized on this Mac.
- **Settings**: Whisper model downloads, local AI with Ollama (any address),
  a search-by-meaning index, and an MCP server switch with a ready-to-copy
  config so Claude, Cursor and other MCP clients can read the vault.
- `memosa mcp`, `memosa migrate` and `memosa reindex` command-line modes.

### Fixed

- A recording is kept in the vault even when no Whisper model is downloaded.
- Vault paths can never reach outside the vault folder.

### Known gaps

- Google Drive text sync has no sign-in yet; Sync now lists what would upload.
- The previous interface is still available with `?ui=legacy` for development.
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
