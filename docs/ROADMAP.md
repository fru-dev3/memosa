# Memosa — Feature Roadmap (DRAFT, pending founder confirmation)

Branch: `feature/windows-and-roadmap`. This is the crash-safe to-do list for the next
wave of features. Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.

> **DRAFT** — proposed below from market research (2026-06-14). Founder confirms/edits,
> then we lock the list and start work. Nothing here is implemented yet.

## North star

Memosa is **the private, local, open-source memory + context layer for your
conversations** — and (uniquely) one your AI tools can actually use. Positioning on
the site: "the context layer for your intelligence." Roadmap should deepen that moat:
truly local, free, cross-platform, and the only one that exposes your meeting corpus
to any AI.

## What Memosa already has (do NOT re-build)

Local record + on-device Whisper transcription · library by date/tags/people/folders ·
SQLite FTS5 search · AI summaries / action items / decisions (built-in, local Ollama,
or BYOK) · chat with your meetings (local RAG) · Google Calendar auto-record · AI
speaker labels · Obsidian + Notion sync · export · bot-free capture.

## Market findings (condensed)

- **Two segments:** cloud bot-joiners (Otter, Fireflies, Fathom, Read, tl;dv) and
  bot-free/local (Granola = hybrid, $18/mo, needs Google + internet for AI).
- **Privacy/local niche is hot and fragmented:** Meetily (OSS, self-hosted, real-time),
  **OpenWhispr (OSS, cross-platform incl. Windows/Linux, bot-free, chat, templates)**,
  MacWhisper (paid, diarization Pro, real-time), Superwhisper, Aiko, WhisperDesk, Alter.
- **Top complaints about the leaders:** bots join uninvited / all-party-consent legal
  risk; cloud dependency + accounts (Granola needs Google + internet); accuracy.
- **The 2026 winning theme:** "turn notes into action" — action items w/ owners + due
  dates, task/CRM sync, and **cross-meeting "ask my history" RAG with citations**.
- **Whisper gap:** no native "who said what" — leaders add diarization (pyannote /
  WhisperKit). Real-time/live transcription is now table stakes in the niche.
- **Our white space:** cross-platform + truly free/OSS + **meetings-as-context-for-AI
  (MCP)**, which nobody in this niche does.

## Proposed roadmap

### P0 — the founder's #1 ask
- [ ] **Windows support.** Tauri app; `cpal` (cross-platform audio) is already a dep, so
  mic capture largely ports. Work: WASAPI/system-audio path, drop `whisper-rs` `metal`
  → CPU/other backend on Windows, `cfg`-gate the macOS ObjC (`macos.rs`,
  `macos_helpers.m`, `mic_permission.m`), Keychain → Windows Credential Manager, NSIS
  installer + CI (mirror Prevail's Windows job). **Feasible, moderate effort.** (Linux
  likely follows cheaply once Windows lands.)

### P1 — highest-value differentiators (research-backed)
- [ ] **MCP server: expose your meetings to any AI.** Let Claude/ChatGPT/agents query
  your local meeting corpus (search, fetch transcript, summaries, decisions) over MCP.
  This is the unique "context layer" moat + ties into the fru.dev app network. Nobody
  in the niche has it.
- [ ] **Real speaker diarization + speaker identification** (who said what; recognize
  recurring people), on-device (pyannote/WhisperKit/sherpa). Upgrade from "AI labels."
- [ ] **Action items that turn into action** — owners + due dates; push to Apple
  Reminders / Things / Todoist; "decisions" and "follow-ups" surfaced across meetings.
- [ ] **Cross-meeting "ask your library" with citations** — upgrade chat/search to
  semantic (local embeddings) over the whole corpus, answers cite the source meeting.

### P2 — strong adds
- [ ] **Live / real-time transcription + live notes** during the meeting (verify current state).
- [ ] **Summary/note templates** per meeting type (1:1, sales, standup, interview).
- [ ] **System-wide quick capture** (global hotkey to start recording anything).
- [ ] **More calendar providers** (Outlook/ICS) + smarter auto-record.
- [ ] **Privacy power features** — redaction, retention/auto-delete policies, optional
  encrypted-at-rest vault.

## Open questions for founder
1. Windows scope: full parity, or "record + transcribe + library" first and AI later?
2. Priority order within P1 — lead with **MCP (context layer)** or **diarization**?
3. Any must-have integration (a specific task manager / CRM) for your own use?
4. Keep everything free/OSS, or is a paid "pro" tier (e.g., hosted sync) ever in scope?
