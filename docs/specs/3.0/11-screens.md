# 11 — Screens (Frontend)

Implement each screen against the IPC API (09) using the design system (10). Mockups in
`docs/design/` are the visual contract. Can be split across agents by screen.

## Screens & their data
- **Library** — `vault_tree` (rail nested tree), `vault_list` (center, day-grouped),
  `vault_get`/`vault_transcript` (detail). Tabs: Summary / Transcript / Speakers / Action items.
  Detail header **Export** menu → `vault_export`. Breadcrumb from path.
- **Transcript tab** — audio player (seek to segment), speaker-colored timestamped utterances.
- **Ask** — chat thread; `ask()` streamed via `ask_token`/`ask_done`; render **citations** +
  Sources list (click → open conversation); scope chip; "stays on your Mac" indicator.
- **Search** — `search()` semantic/exact toggle; results with folder breadcrumb, highlighted
  snippet, relevance; ranked-by-meaning meta.
- **Tasks** — `tasks_all(filter)`; grouped by due (Overdue/This week/No date); `task_toggle`
  writes back to notes.md; source-conversation chips.
- **Capture overlay** — `capture_*`; live waveform (`capture_progress`) + live transcript
  (`transcript_partial`); Stop & save.
- **Command palette (⌘K)** — jump to folder/conversation, run actions, ask; fed by tree+search.
- **Settings** — panels: Appearance (theme/type/density), Privacy & Mode (Bunker/Cloud +
  redaction), AI & Models (policy local-only, whisper/Ollama/embed pickers), Vault & Storage
  (location, store-as-files toggles, MCP toggle + config, Drive text-sync), Calendar &
  Auto-record. Bind to `settings_*`, `models_*`, `mcp_*`, `sync_*`, `calendar_*`, `vault_path`.
- **Empty / first-run** — hero (Start recording / Import), feature cards, privacy note; rail
  shows "No domains yet → New domain".

## Behaviors
- Live refresh on `vault_changed` (re-fetch tree/list). Optimistic task toggles.
- Keyboard: ⌘K palette, ⌘R capture, Esc closes overlays, tab nav in lists.

## Acceptance
Each mockup screen is reproduced and wired to real commands; clicking through performs real
vault operations (create folder, move, toggle task, export, ask, search).
