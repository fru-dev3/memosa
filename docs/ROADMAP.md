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
- [x] **LIVE-VERIFIED**: fixed local Ollama (`brew reinstall`), ran `memosa reindex` (35 chunks
      over the real corpus), and a semantic query ("insurance coverage and pricing") correctly
      surfaced the Obie Insurance / water-damage meetings by meaning via the MCP `semantic_search`.

### 4. Real on-device speaker diarization + speaker identity  `[~]` FOUNDATION done; acoustic engine deferred
Upgrade "AI speaker labels" to true who-said-what + recurring-voice recognition.
- [x] Engine chosen: **sherpa-onnx** (cross-platform → lands with Windows; pyannote-style
      segmentation + speaker-embedding clustering on-device).
- [x] Data model + interface: `speaker_segments` table; `diarize` module with `SpeakerSegment`,
      `Diarizer` trait, tested `merge_adjacent`; DB store/load; `get_speaker_segments` command;
      MCP `get_speakers` tool (6 tools total). 26/26 lib tests pass.
- [ ] **BLOCKED in this env:** the acoustic backend itself — adding the sherpa-onnx native dep +
      bundling/auto-downloading the ONNX models + aligning with whisper segments. This is a large
      native integration that can't be safely added-and-verified here (no way to validate the ONNX
      runtime build offline; pairs with Windows). Storage/interface/surfacing are ready so the
      backend swap is localized.
- [ ] UI to name/merge/split speakers; cross-meeting voice fingerprinting (after the engine)

### 5. Trust posture (mostly positioning, pairs with Bunker)  `[x]` DONE
- [x] In-app guarantee copy already strong in About ("everything locally", "stays on your Mac",
      local-first vs Otter/Fireflies) + persistent Bunker/Cloud StatusBar badge + tooltips
- [x] Site carries GPL-3.0 + "never trained / audio never leaves device" + privacy page (shipped earlier)
- [ ] (future) richer in-app network-activity transparency panel

---

## P1 (after P0)
- [~] **Windows support** — IN PROGRESS (compile-enablement + CI verification loop):
  - [x] `whisper-rs` metal feature made macOS-only (target-specific deps; CPU build elsewhere)
  - [x] `macos` module now compiles cross-platform: real ObjC impls under `cfg(macos)` +
        fallbacks for Windows/Linux (open_url works via `start`; audio-conversion/AAC/bookmarks
        return clear "not on this platform yet" errors so the app builds while those port)
  - [x] `windows-check.yml` CI builds the Rust app on `windows-latest` (the verification loop)
  - [ ] Make CI green (iterate on Windows compile errors); then real WASAPI/system-audio +
        `convert_to_whisper_format` (symphonia-based) + AAC alternative; then NSIS installer + release job
- [ ] Real-time / live transcription + live notes (LiveTranscriber scaffold exists)

## P2
- [x] **Redaction** — scrub emails/keys/card-SSN-phone from transcripts before any cloud (BYOK)
      send; `redact_secrets` setting (on by default) + Settings toggle; `privacy::redact` + 2 tests.
- [x] Summary/note templates per meeting type — already shipped (`summary_template_prompts` +
      `custom_summary_templates` in settings + UI).
- [x] Retention / auto-delete — already shipped (`retention_policy` + daily cleanup + Settings UI).
- [ ] Action items → owners/due dates → Reminders/Things/Todoist (doable on macOS via osascript/EventKit)
- [ ] On-device translation (Whisper translate task) · global quick-capture hotkey (plugin is
      currently disabled for stability) · Outlook/ICS calendar · encrypted-at-rest vault (heavy)

---

## Status of remaining work (honest)
**Done this session (all pushed to the branch):** P0.1 Bunker/Cloud, P0.2 MCP server,
P0.3 semantic search, P0.5 trust + badge, P0.4 *foundation*, P2 redaction. 28/28 rust tests pass.

**Genuinely blocked in THIS environment (need resources/decisions, not more coding):**
1. **P0.4 acoustic diarization engine** — needs the sherpa-onnx native dep + bundled ONNX models;
   a large native integration that can't be added-and-verified offline here. Best done with Windows.
2. **P1 Windows** — needs a Windows build/test target + a WASAPI audio path + CoreML→sherpa port.
   Can't be compiled/verified from this macOS-only environment.
3. **Live ML verification** (Ollama-backed insights/chat/semantic embed) — this machine's Ollama
   0.30.6 is broken (missing llama-server). Code paths are correct + fail gracefully; live runs
   need a working Ollama (or the App Store build's environment).
To unblock: provide a Windows CI/runner, fix/replace local Ollama, and approve adding the
sherpa-onnx native dependency (it's sizable). Then the deferred items can proceed.

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
- 2026-06-14: **P0.5 trust DONE** (mode badge + About copy + site). **P0.4 FOUNDATION DONE**
  (speaker_segments + Diarizer interface + MCP get_speakers; 26/26 tests). Acoustic engine
  (sherpa-onnx) deferred — large native dep + models, pairs with P1 Windows. Next: P1.
