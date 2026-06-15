# Memosa — Feature Roadmap (LOCKED 2026-06-14)

Branch: `feature/windows-and-roadmap`. **Crash-safe checklist — keep updated after every step.**
Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

**Confirmed decisions:** sequencing = **A (differentiator-first)**; free/OSS (no paid tier yet);
no required 3rd-party integration; Windows deferred to P1. Build order below is the work order.

**North star:** the private, local, open-source memory + context layer for your conversations,
and the only one your AI tools can use. Differentiator = local-first MCP. (Backed by deep
research run `wf_9e3ab903-2ee`, 23/25 claims verified.)

---

## BUILD NOW — P0 (in order)

### 1. Bunker mode / Cloud mode  `[x]` DONE
A global app mode that makes the privacy posture explicit and enforceable.
- [x] `app_mode` setting: `bunker` (default) | `cloud` (`types.rs` AppMode, serde default Bunker)
- [x] **Bunker**: cloud BYOK refused fail-closed via `ensure_cloud_allowed()` in `insights::generate`
      + `generate_text`; Notion sync refused in `sync_meeting_to_notion`. Ollama/Built-in still work.
- [x] **Cloud**: BYOK provider + Keychain key flow (unchanged) usable only in Cloud mode
- [x] Single enforcement chokepoint (`ensure_cloud_allowed`) — the BYOK arms route through it
- [x] Settings UI (`SettingsView` renderAi): Bunker/Cloud segmented switch; cloud engine option +
      BYOK fields hidden in Bunker; "paused" note if a stale BYOK selection + Bunker
- [x] Test: `insights::mode_tests::bunker_refuses_cloud_cloud_allows` (passing)
- [ ] (deferred polish) persistent app-wide mode badge outside Settings

### 2. Local-first MCP server (★ highest-leverage differentiator)  `[ ]`
Expose the meeting corpus to external AI agents (Claude/ChatGPT/Cursor/Ollama) over MCP.
- [ ] MCP server over stdio (Rust), reading the existing SQLite DB
- [ ] Tools: `list_meetings`, `search_meetings` (FTS + semantic), `get_transcript`,
      `get_summary`, `get_action_items`, `get_decisions`
- [ ] Opt-in "Enable MCP server" toggle in Settings (off by default) + clear note that a
      connected cloud AI client may send retrieved data to that client
- [ ] Connect helper: copy-paste config for Claude Desktop / Claude Code / Cursor with the path
- [ ] Resolve the server binary path robustly (bundled sidecar or `memosa mcp` subcommand)
- [ ] Tests: tool calls return correct rows; respects enable toggle

### 3. Local semantic search (embeddings)  `[ ]`
Upgrade search/RAG beyond keyword FTS; feeds both in-app chat and the MCP `search_meetings`.
- [ ] Local embeddings (Ollama `nomic-embed-text` in bunker, or bundled ONNX) over transcript chunks
- [ ] Vector index (sqlite-vec or equivalent) alongside FTS5; hybrid search
- [ ] "Ask your meetings" answers cite the source meeting(s)
- [ ] Tests: embed → index → nearest-neighbour round-trip

### 4. Real on-device speaker diarization + speaker identity  `[ ]` (heaviest)
Upgrade "AI speaker labels" to true who-said-what + recurring-voice recognition.
- [ ] Choose engine: sherpa-onnx (cross-platform, helps future Windows) vs WhisperKit/SpeakerKit (macOS CoreML)
- [ ] Sidecar/bundled models (auto-download on first use), diarization step in the transcription pipeline
- [ ] Persist speaker segments; UI to name/merge/split speakers; cross-meeting voice fingerprinting
- [ ] Tests: segment storage round-trip

### 5. Trust posture (mostly positioning, pairs with Bunker)  `[ ]`
- [ ] Explicit "never trained on your data / audio never leaves device" guarantee in-app + on site
- [ ] Verifiable privacy page; in-app network-activity transparency

---

## P1 (after P0)
- [ ] **Windows support** (NSIS + CI; Windows audio, non-CoreML diarization via sherpa-onnx, CUDA/Vulkan/CPU)
- [ ] Real-time / live transcription + live notes

## P2
- [ ] Action items → owners/due dates → Reminders/Things/Todoist
- [ ] Summary/note templates per meeting type · global quick-capture hotkey · Outlook/ICS calendar
- [ ] On-device translation · redaction / retention / encrypted-at-rest

---

## Progress log
- 2026-06-14: roadmap locked (sequencing A). Mapped codebase (4 explore agents).
- 2026-06-14: **P0.1 Bunker/Cloud mode DONE** — fail-closed gate, UI switch, test passing.
  Next: P0.2 local-first MCP server (`memosa mcp` stdio subcommand over the SQLite corpus).
