# Memosa — Feature Roadmap (DRAFT, pending founder confirmation)

Branch: `feature/windows-and-roadmap`. Crash-safe to-do list for the next feature wave.
Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

> **DRAFT** — backed by deep research (2026-06-14, 102-agent run `wf_9e3ab903-2ee`,
> 23/25 claims verified). Founder confirms sequencing (see "Decision needed"), then we lock and build.

## North star

Memosa = **the private, local, open-source memory + context layer for your conversations,
and the only one your AI tools can actually use.** Site positioning: "the context layer for
your intelligence." The research strongly validates this exact thesis as the moat.

## The single highest-leverage differentiator (verified)

**Expose your meeting corpus to external AI agents via a LOCAL-FIRST MCP server.** This is
not speculative: Granola shipped an MCP server (Feb 2026) and raised **$125M at a $1.5B
valuation (Mar 2026)** explicitly to become "meetings → enterprise AI app"; competitor
**Alice** already ships an MCP server exposing recordings/transcripts to Claude/ChatGPT/Grok/
Gemini. Neither cloud incumbent can match a corpus that **never leaves the device** and is
queried by your *local* Ollama/BYOK agents. Ties directly into the fru.dev app network.

## What the research changed about our plan

- **MCP > Windows on leverage.** Research recommends shipping the MCP differentiator
  *before* Windows, because Windows is "parity-without-differentiation on a second platform"
  and **a free OSS rival (Meetily) already ships Windows + Linux with CUDA/Vulkan.** Windows
  is real gated TAM but HIGH effort (CoreML diarization/accel paths do NOT port).
  **→ This conflicts with the founder's stated "Windows first." See Decision needed.**
- **Our core is now contested, not unique.** OpenWhispr, Meetily, AnythingLLM Meeting
  Assistant, Natively all ship local transcription + diarization + local RAG/BYOK/Ollama.
  Transcription/diarization/search = **table stakes (reach parity), not a moat.**
- **Trust is a cheap, real edge.** Granola trains on user notes **by default** (opt-out,
  hard-to-find). Memosa (audio never leaves device, no training) can claim a strictly
  stronger, verifiable posture — high value to **regulated personas** (therapists, lawyers,
  doctors, journalists). (Do NOT use two refuted attacks: Granola "every note public by URL"
  = false; Natively "Cluely breach" = false.)
- **Our GUI is a moat vs the OSS tier.** The strongest local pipelines (HushNote, Trail of
  Bits' Scribe) are Linux/macOS **CLIs**. Memosa's polished one-click Tauri GUI is a genuine
  advantage for non-technical users — protect it.

## DECISION NEEDED (sequencing)

Founder wanted **Windows first**; research says **MCP differentiator first, Windows second.**
Pick one:
- **(A) Differentiator-first** (research pick): MCP + diarization parity + trust, then Windows.
- **(B) Reach-first** (founder's instinct): Windows first for TAM, then MCP.
- **(C) Parallel:** Windows is largely independent work; MCP + Windows can run side by side.

## Proposed roadmap (order assumes A; flip if you choose B)

### P0 — differentiator + parity
- [ ] **Local-first MCP server** — expose corpus (search / fetch transcript / summaries /
  decisions / segment search) to Claude/ChatGPT/Ollama/agents. Data stays on device. **MEDIUM**
  effort (already in SQLite/FTS5). Neutralizes Granola + Alice. Persona: founders, consultants,
  sales, researchers. **★ highest-leverage.**
- [ ] **Real on-device speaker diarization + speaker identity** (recurring-voice fingerprinting),
  upgrade from "AI speaker labels." Shippable via WhisperKit/SpeakerKit (Pyannote v4 CoreML),
  sherpa-onnx, or a Rust path (speakrs). **MEDIUM** (sidecar). Parity vs OpenWhispr/AnythingLLM.
- [ ] **Local semantic search (embeddings)** over the whole library via sqlite-vec/ONNX, feeding
  both in-app "ask your meetings" (with citations) and the MCP index. **LOW–MEDIUM.**
- [ ] **Private-by-default trust posture** — explicit "we never train on your data / audio never
  leaves your device" guarantee + verifiable privacy page + in-app indicators. **LOW.** Targets
  regulated personas; neutralizes Granola's soft underbelly.

### P1
- [ ] **Windows support** (NSIS + CI like Prevail). **HIGH** effort: re-implement audio capture,
  diarization sidecar, and GPU accel for Windows (CoreML does not port; use CUDA/Vulkan/CPU).
  Captures TAM Meetily is taking. (Promote to P0 if you choose ordering B.)
- [ ] **Real-time / live transcription + live notes** (feasible: Moonshine ~107ms, streaming
  diarization; quality unproven, validate first).

### P2
- [ ] Action items → owners/due dates → push to Reminders/Things/Todoist.
- [ ] Summary/note templates per meeting type. · Global quick-capture hotkey. · More calendar
  providers (Outlook/ICS). · On-device translation. · Redaction / retention / encrypted-at-rest.

## Research caveats / gaps (worth knowing)
- The verified corpus is strong on **competitor + technical** evidence but thin on **direct
  user voice** (no surviving Reddit/G2/App-Store quotes), **persona market-size/WTP**, and a
  **cloud-bot-joiner matrix** (Otter/Fireflies/Fathom/etc.). Persona priorities below are
  inference from the privacy-posture finding, not measured demand. A focused follow-up on
  user complaints + WTP + personas is available if you want it before locking.

## Open questions for founder
1. **Sequencing A / B / C above** (the big one).
2. Want a **follow-up research pass** on user-voice + personas + WTP to fill the gap?
3. Any must-have integration for your own workflow (specific task manager / CRM)?
4. Stay fully free/OSS, or leave room for a paid pro tier (e.g., hosted/cross-device sync)?
