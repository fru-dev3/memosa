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
- [x] Persistent app-wide mode badge in the StatusBar (Bunker = filled accent dot; Cloud = outline)

### 2. Local-first MCP server (★ highest-leverage differentiator)  `[x]` DONE
Expose the meeting corpus to external AI agents (Claude/ChatGPT/Cursor/Ollama) over MCP.
- [x] MCP stdio JSON-RPC 2.0 server (`src-tauri/src/mcp/mod.rs`, hand-rolled, no MCP crate),
      reads the SQLite DB READ-ONLY. Launched via `memosa mcp` subcommand (branch in main.rs).
- [x] Tools: `list_meetings`, `search_meetings` (FTS), `get_meeting` (summary/action_items/
      decisions/tags/people/attendees), `get_transcript`. (Semantic search folds in at P0.3.)
- [x] Opt-in `mcp_server_enabled` (off by default); tools/call refuses with a clear message
      when disabled. Note shown that a connected cloud client may send retrieved data onward.
- [x] Connect helper: `mcp_connect_info` command returns the binary path + paste-ready config;
      Settings shows it. Path resolved via `std::env::current_exe()`.
- [x] Verified live against the real 14-meeting DB (list + FTS search returned real rows);
      protocol (initialize/tools/list/tools/call) verified; gate verified.
- [ ] (caveat) sandbox-container vs non-container DB path if the MCP process runs unsandboxed —
      revisit when packaging the signed build / Windows.

### 3. Local semantic search (embeddings)  `[x]` DONE
Upgrade search/RAG beyond keyword FTS; feeds both in-app chat and MCP.
- [x] Local embeddings via Ollama (`embed_model`, default `nomic-embed-text`) over transcript chunks
      (`src-tauri/src/search/mod.rs`: embed/cosine/chunk)
- [x] `embeddings` table (f32 LE blobs); brute-force cosine ranking (fine for personal scale)
- [x] Hybrid: chat retrieval merges FTS + semantic candidates (best-effort, falls back to FTS)
- [x] MCP `semantic_search` tool (5 tools total); `rebuild_embeddings`/`embedding_status` commands;
      `memosa reindex` CLI; Settings "Build/Rebuild index" button + chunk-count status
- [x] Tests: cosine, chunking, blob round-trip + ranking (3 tests). 24/24 lib tests pass.
- [ ] (caveat) live embedding round-trip not verified — this machine's Ollama 0.30.6 is broken
      (missing llama-server binary, affects all Ollama features); code path + graceful error verified.

### 4. Real on-device speaker diarization + speaker identity  `[ ]` (heaviest)
Upgrade "AI speaker labels" to true who-said-what + recurring-voice recognition.
- [ ] Choose engine: sherpa-onnx (cross-platform, helps future Windows) vs WhisperKit/SpeakerKit (macOS CoreML)
- [ ] Sidecar/bundled models (auto-download on first use), diarization step in the transcription pipeline
- [ ] Persist speaker segments; UI to name/merge/split speakers; cross-meeting voice fingerprinting
- [ ] Tests: segment storage round-trip

### 5. Trust posture (mostly positioning, pairs with Bunker)  `[x]` DONE
- [x] In-app guarantee copy already strong in About ("everything locally", "stays on your Mac",
      local-first vs Otter/Fireflies) + persistent Bunker/Cloud StatusBar badge + tooltips
- [x] Site carries GPL-3.0 + "never trained / audio never leaves device" + privacy page (shipped earlier)
- [ ] (future) richer in-app network-activity transparency panel

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
- 2026-06-14: **P0.2 MCP server DONE** — `memosa mcp` stdio server (4 tools), opt-in toggle +
  connect config in Settings; verified live against the real corpus. 22/22 rust tests pass.
  Next: P0.3 local semantic search (embeddings) feeding chat + MCP `search_meetings`.
- 2026-06-14: **P0.3 semantic search DONE** — embeddings table, Ollama embed, hybrid chat,
  MCP semantic_search tool, reindex CLI + Settings button. 24/24 tests. (Live embed blocked by
  broken local Ollama.) Next: P0.4 diarization (heaviest) or P0.5 trust copy.
