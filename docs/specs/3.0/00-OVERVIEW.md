# Memosa 3.0 — Architecture Overview & Spec Index

## North star
Memosa is a **personal memory vault**. The app is the front door; the product is a
single folder of **plain files** the user owns and any AI can read.

## Hard principles (non-negotiable)
1. **Files only. No database.** Source of truth = files on disk. Structured data is
   **JSON / JSONL**; notes are **Markdown**; audio is a media file. There is **no SQLite**,
   no embedded DB. Any "index" is itself a JSONL/JSON file, fully rebuildable from the vault.
2. **The folder tree IS the data model.** Domains and folders are real directories.
   "Life › Dad › Medical" == `vault/memosa/Life/Dad/Medical/`. Moving = a filesystem move.
3. **Local & open-source models by default.** whisper.cpp (transcribe), Ollama OSS LLMs
   (summarize/chat), local embeddings. Cloud/frontier is opt-in only, gated by Bunker mode.
4. **AI-consumable.** Other AIs point at the vault folder directly, and/or via the local
   **MCP** server (read-only). MCP is a convenience layer over the same files.
5. **Local-first privacy.** Audio never leaves the Mac. Optional Drive sync is **text only**.

## Vault location (decided)
`~/Documents/fru/vault/memosa/` (inside the existing fru monorepo `vault/`).

## Tech
Tauri 2 app — **Rust** backend (vault, transcription, AI, MCP, calendar, sync),
**React + TypeScript + Zustand** frontend. No DB dependency anywhere.

## Module map (→ owning spec)
| Layer | Module | Spec |
|---|---|---|
| Contract | Vault file format & schemas | 01 |
| Contract | Tauri IPC command/event API | 09 |
| Backend | Vault core (read/write/watch/move) | 02 |
| Backend | Search & index (JSONL embeddings + keyword) | 03 |
| Backend | Capture & transcription (whisper.cpp) | 04 |
| Backend | Local AI / models (Ollama, policy, Bunker gate) | 05 |
| Backend | MCP server over the vault | 06 |
| Backend | Calendar & auto-record (Google) | 07 |
| Backend | Drive sync (text only) | 08 |
| Frontend | Design system & shared components | 10 |
| Frontend | Screens | 11 |
| One-off | Migration: current DB → files | 12 |

## Parallelization plan (for the coding session)
**Phase A — lock contracts (must finish before fan-out):** specs **01** and **09**.
These define every file schema and every backend↔frontend call. One agent each, reviewed,
frozen. Everything else codes against them.

**Phase B — parallel fan-out (independent agents, isolated worktrees):**
- Agent: Vault core (02) — depends on 01
- Agent: Search & index (03) — depends on 01
- Agent: Capture & transcription (04) — depends on 01
- Agent: Local AI / models (05) — depends on 01
- Agent: MCP server (06) — depends on 01
- Agent: Design system (10) — depends on 09
- Agent: Screens (11) — depends on 09, 10
- Agent: Calendar (07), Drive sync (08) — depend on 01/02
- Agent: Migration (12) — depends on 01

**Phase C — integration:** wire IPC (09) ends together, run the app, fix seams, verify
against acceptance criteria. Single integrator (me) pulls branches together.

## Definition of done (3.0)
Record a meeting → it lands as files under `vault/memosa/<Domain>/<Folder>/<conv>/`
(audio + transcript.json + notes.md + meta.json) → it's searchable by meaning →
askable with citations → visible in the redesigned UI → and a second AI (Claude) can read
it over MCP. All models local. No database anywhere.
