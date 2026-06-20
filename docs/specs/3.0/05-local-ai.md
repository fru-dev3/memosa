# 05 — Local AI / Models (OSS-first)

Summaries, chat/Ask, and embeddings — all local & open-source by default. Depends on **01**.

## Model policy
- `ModelConfig` in `.memosa/config.json`:
  ```json
  { "policy":"local_only", "transcribe":"whisper-large-v3",
    "llm":"llama3.1:8b", "embed":"nomic-embed-text",
    "cloud": { "enabled":false, "provider":null } }
  ```
- `policy: "local_only"` (default) ⇒ the cloud path is unreachable. `"allow_cloud"` unlocks a
  BYOK provider for summaries/chat only. **Bunker mode forces local_only** regardless.
- Single enforcement chokepoint `ensure_allowed(target)` — every generate call routes through
  it; cloud is refused fail-closed when not allowed.

## Backends
- **LLM (summaries + chat):** Ollama HTTP (`/api/generate`, `/api/chat`) with an open-weight
  model (Llama 3.1 / Qwen2.5 / Mistral). Detect Ollama; if missing, degrade gracefully with a
  clear "install/​start Ollama" message — never silently fall back to cloud.
- **Embeddings:** Ollama `nomic-embed-text` (or built-in). Vectors → spec 03.
- **Transcription model** selection is consumed by spec 04.

## Functions
- `summarize(id)` — read transcript → prompt → write `notes.md` (Summary, Decisions,
  Action items with owners/dues parsed into the comment metadata).
- `ask(q, scope)` — retrieve chunks (spec 03) → grounded prompt → stream answer tokens
  (`ask_token`) → emit `ask_done` with **citations** mapping claims to source conversations.
- `redact(text)` — scrub emails/keys/card/SSN/phone before any cloud send (only relevant in
  allow_cloud; on by default).

## Acceptance
With Ollama running and policy=local_only: recording produces a real summary + action items
in `notes.md`, and Ask answers with citations — verified with **no outbound network** beyond
localhost Ollama. With cloud disabled, any attempt to reach a frontier API is refused.
