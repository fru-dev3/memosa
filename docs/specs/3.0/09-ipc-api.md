# 09 — Tauri IPC: Command & Event API  ⟨CONTRACT — freeze before fan-out⟩

The backend↔frontend boundary. Frontend calls **commands** (`invoke`); backend pushes
**events** (`emit`). All types are JSON; shapes reference spec 01. No DB types ever cross.

## TypeScript types (shared)
```ts
type ConvId = string;                       // vault-relative path, see 01
interface TreeNode { kind:'domain'|'folder'|'conversation'; name:string; path:string;
  count?:number; children?:TreeNode[]; icon?:string; }
interface ConvMeta { id:ConvId; title:string; created:string; duration_sec:number;
  people:string[]; tags:string[]; source:string; }
interface Segment { start:number; end:number; speaker:string; text:string }
interface Transcript { language:string; model:string; speakers:Record<string,string>;
  segments:Segment[] }
interface Notes { summary:string; decisions:string[]; actions:Task[]; markdown:string }
interface Task { conv:ConvId; text:string; done:boolean; owner?:string; due?:string }
interface SearchHit { conv:ConvId; title:string; path:string; snippet:string;
  score:number; date:string }
interface Citation { n:number; conv:ConvId; title:string; path:string; quote:string }
interface AskAnswer { text:string; citations:Citation[] }
```

## Commands (Rust `#[tauri::command]`)
**Vault (→02)**
- `vault_tree() -> TreeNode`
- `vault_list(path:string) -> ConvMeta[]`
- `vault_get(id:ConvId) -> { meta:ConvMeta, notes:Notes }`
- `vault_transcript(id:ConvId) -> Transcript`
- `vault_create_folder(path:string) -> void`
- `vault_move(id:ConvId, destFolder:string) -> ConvId`   // returns new id
- `vault_rename(id:ConvId, title:string) -> ConvId`
- `vault_delete(id:ConvId) -> void`                       // trash, not hard-delete
- `vault_set_tags(id:ConvId, tags:string[]) -> void`
- `vault_export(id:ConvId, fmt:'pdf'|'md'|'txt'|'srt'|'vtt'|'m4a'|'json', dest:string) -> string`

**Search / Ask (→03,05)**
- `search(q:string, mode:'semantic'|'exact', scope?:string) -> SearchHit[]`
- `ask(q:string, scope?:string) -> AskAnswer`            // streams via `ask_token` event
- `tasks_all(filter:'open'|'done'|'all') -> Task[]`
- `task_toggle(conv:ConvId, text:string, done:boolean) -> void`  // writes notes.md
- `index_rebuild() -> void`  ·  `index_status() -> { chunks:number, stale:number }`

**Capture / transcription (→04)**
- `capture_start(folder:string, title?:string) -> ConvId`
- `capture_stop() -> ConvId`  ·  `capture_pause()/resume()`
- `import_audio(srcPath:string, folder:string) -> ConvId`

**AI / models (→05)**
- `models_get() -> ModelConfig`  ·  `models_set(cfg:ModelConfig) -> void`
- `summarize(id:ConvId) -> void`                         // regenerates notes.md

**MCP / Calendar / Sync / Settings (→06,07,08)**
- `mcp_status() -> {enabled:boolean}` · `mcp_toggle(on:boolean)` · `mcp_connect_info() -> string`
- `calendar_status()` · `calendar_connect()` · `calendar_upcoming() -> CalEvent[]` · `autorecord_set(cfg)`
- `sync_status()` · `sync_now()` · `sync_set(cfg)`
- `settings_get() -> Config` · `settings_set(patch) -> void`     // .memosa/config.json
- `vault_path() -> string` · `vault_set_path(p:string) -> void` · `vault_reveal(id?:ConvId)`

## Events (backend → frontend, `emit`)
- `capture_progress { seconds, level }` · `transcript_partial { id, segment }`
- `ask_token { text }` · `ask_done { citations }`
- `index_progress { done, total }` · `vault_changed { path }`   // file watcher → UI refresh
- `autorecord_prompt { event }`     // "meeting starting, record?"
- `sync_progress { done, total }` · `toast { kind, message }`

## Rules
- Commands are **async**, return `Result<T,String>`; the string error surfaces as a toast.
- No streaming return values — stream via events keyed by a call id where needed.
- Frontend never touches the filesystem directly; everything goes through these commands.

## Acceptance
Every screen in spec 11 can be built against these signatures with a mock backend; swapping
the real Rust impl requires zero frontend changes.
