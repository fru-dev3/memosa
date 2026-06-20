# 06 — MCP Server over the Vault

Expose the vault read-only to external AIs (Claude, Cursor, local agents). Depends on **01**,
**02**, **03**. The whole point of the product: other AIs consume your memory.

## Shape
- `memosa mcp` subcommand → stdio JSON-RPC 2.0 server (hand-rolled, no MCP crate dependency).
- Reads the **files directly** (vault core, read-only). No DB. Resolves vault root from config.
- Opt-in: `mcp_toggle(on)`; when off, `tools/call` refuses with a clear message.
- `mcp_connect_info()` returns a paste-ready client config:
  ```json
  { "mcpServers": { "memosa": { "command": "memosa", "args": ["mcp"] } } }
  ```

## Tools
- `list_domains()` — the folder tree (domains/folders + counts).
- `list_conversations(folder?, limit?)` — meta rows.
- `get_conversation(id)` — meta + notes.md (summary/decisions/actions).
- `get_transcript(id)` — segments (+ speakers).
- `search(query, mode?, scope?)` — semantic/exact/hybrid (spec 03).
- `get_speakers(id)` — speaker map/segments (foundation).

## Rules
- Strictly read-only in 3.0 (no write tools). Path-scoped to the vault; reject traversal.
- A note in tool output reminds that a connected **cloud** client may forward retrieved text.

## Acceptance
From Claude Desktop with the pasted config: `list_conversations` then `search "insurance"`
return real rows from the file vault; protocol (initialize/tools/list/tools/call) verified;
disabled-gate verified.
