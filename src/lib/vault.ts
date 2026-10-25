// Typed IPC client for the files-only vault (spec 09). The UI talks to the vault
// only through these wrappers, never the filesystem directly.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type NodeKind = "domain" | "folder" | "conversation";

export interface TreeNode {
  kind: NodeKind;
  name: string;
  path: string;
  count?: number;
  children?: TreeNode[];
}

export interface ConvMeta {
  schema: number;
  id: string;
  title: string;
  created: string;
  duration_sec: number;
  people: string[];
  accounts: string[];
  tags: string[];
  suggested?: Suggested;
  source: string;
  audio: string;
  updated?: string;
}

// People and accounts are notes in the vault (People/<Name>.md, Accounts/<Name>.md).
export type LinkKind = "person" | "account" | "tag";
export interface Suggested {
  people: string[];
  accounts: string[];
  tags: string[];
  dismissed: string[];
}
export interface Entity {
  kind: "person" | "account";
  name: string;
  aliases: string[];
  account?: string | null;
  body: string;
}
export interface Directory {
  entities: (Entity & { count: number })[];
  tags: { name: string; count: number }[];
}
export interface Links {
  people: string[];
  accounts: string[];
  tags: string[];
}

export interface Segment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface Transcript {
  schema: number;
  language: string;
  model: string;
  speakers: Record<string, string>;
  segments: Segment[];
}

export interface Task {
  conv: string;
  text: string;
  done: boolean;
  owner?: string;
  due?: string;
}

export interface Notes {
  summary: string;
  decisions: string[];
  actions: Task[];
  markdown: string;
}

export interface ConvBundle {
  meta: ConvMeta;
  notes: Notes;
}

export interface SearchHit {
  conv: string;
  title: string;
  path: string;
  snippet: string;
  score: number;
  date: string;
}

export interface Citation {
  n: number;
  conv: string;
  title: string;
  path: string;
  quote: string;
}

export interface AskAnswer {
  text: string;
  citations: Citation[];
  grounded: boolean;
}

export const vault = {
  tree: () => invoke<TreeNode>("vault_tree"),
  list: (path: string) => invoke<ConvMeta[]>("vault_list", { path }),
  get: (id: string) => invoke<ConvBundle>("vault_get", { id }),
  transcript: (id: string) => invoke<Transcript>("vault_transcript", { id }),
  createFolder: (path: string) => invoke<void>("vault_create_folder", { path }),
  createConversation: (folder: string, title: string) =>
    invoke<string>("vault_create_conversation", { folder, title }),
  move: (id: string, dest: string) => invoke<string>("vault_move", { id, dest }),
  rename: (id: string, title: string) => invoke<string>("vault_rename", { id, title }),
  remove: (id: string) => invoke<void>("vault_delete", { id }),
  setTags: (id: string, tags: string[]) => invoke<void>("vault_set_tags", { id, tags }),
  toggleTask: (conv: string, text: string, done: boolean) =>
    invoke<void>("task_toggle", { conv, text, done }),
  path: () => invoke<string>("vault_path"),
  setPath: (path: string) => invoke<void>("vault_set_path", { path }),

  // provided by the search-over-vault module (workflow)
  search: (q: string, mode: "semantic" | "exact", scope?: string) =>
    invoke<SearchHit[]>("vault_search", { q, mode, scope }),
  tasks: (filter: "open" | "done" | "all") => invoke<Task[]>("vault_tasks", { filter }),
  ask: (q: string, scope?: string) => invoke<AskAnswer>("vault_ask", { q, scope }),

  // capture / transcription (spec 04)
  importAudio: (src: string, folder: string, title?: string) =>
    invoke<string>("vault_import_audio", { src, folder, title }),
  // summarize (spec 05)
  summarize: (id: string) => invoke<void>("vault_summarize", { id }),
  // semantic index (spec 03)
  reindex: () => invoke<number>("vault_reindex"),
  embeddingStatus: () =>
    invoke<{ chunks: number; stale: number; conversations: number }>("vault_embedding_status"),
  // calendar auto-file (spec 07)
  calendarAutofile: (title: string, attendees: string[], startIso: string, eventId: string) =>
    invoke<string>("vault_calendar_autofile", { title, attendees, startIso, eventId }),
  // drive text-sync (spec 08)
  syncStatus: () => invoke<{ enabled: boolean; last?: string; pending: number; connected: boolean }>("vault_sync_status"),
  syncNow: () =>
    invoke<{ uploaded: number; pending: number; errors: string[]; connected: boolean; message: string; last?: string }>(
      "vault_sync_now",
    ),
  syncSet: (enabled: boolean, includeAudio: boolean) =>
    invoke<unknown>("vault_sync_set", { enabled, includeAudio }),
  transcribe: (id: string) => invoke<void>("vault_transcribe", { id }),
  pickAudio: () => invoke<string | null>("pick_audio_file"),
  pickFolder: () => invoke<string | null>("pick_vault_folder"),
  defaultPath: () => invoke<string>("vault_default_path"),
  resetPath: () => invoke<string>("vault_reset_path"),
  audioPath: (id: string) => invoke<string | null>("vault_audio_path", { id }),
  setCaptureTarget: (target: { folder: string; people?: string[]; accounts?: string[]; tags?: string[]; eventId?: string } | null) =>
    invoke<void>("vault_set_capture_target", { target }),
  onChanged: (cb: () => void) => listen("vault_changed", () => cb()),
  directory: () => invoke<Directory>("vault_directory"),
  linked: (kind: LinkKind, name: string) => invoke<ConvMeta[]>("vault_linked", { kind, name }),
  setLinks: (id: string, l: Links) => invoke<ConvMeta>("vault_set_links", { id, ...l }),
  answerSuggestion: (id: string, kind: LinkKind, name: string, accept: boolean) =>
    invoke<ConvMeta>("vault_answer_suggestion", { id, kind, name, accept }),
  saveEntity: (entity: Entity, oldName?: string) => invoke<void>("vault_save_entity", { entity, oldName: oldName ?? null }),
  suggest: (id: string) => invoke<ConvMeta>("vault_suggest", { id }),
  setCaptureLinks: (l: Links) => invoke<void>("vault_set_capture_links", { ...l }),
  captureLinks: () =>
    invoke<[string[], string[], string[]]>("vault_capture_links").then(([people, accounts, tags]) => ({ people, accounts, tags })),
  mcpInfo: () => invoke<{ binaryPath: string; config: string }>("mcp_connect_info"),
  reveal: (id?: string) => invoke<void>("vault_reveal", { id }),
  exportMarkdown: (id: string) => invoke<string>("vault_export_markdown", { id }),
  // provided by the migration module
  migrate: () => invoke<{ conversations: number; audio_copied: number; skipped: number; errors: string[] }>(
    "vault_migrate_run",
  ),
};

// Recording, wired to the existing recorder (backward compatible: recordings appear
// in both the legacy app and, via the finalize hook, the vault).
export interface RecStatus {
  is_recording: boolean;
  meeting_id?: string;
  duration_seconds?: number;
}
export const recorder = {
  start: (title: string) =>
    invoke<void>("start_recording", { meetingId: crypto.randomUUID(), title, profileId: null }),
  stop: () => invoke<{ meeting_id: string; duration_seconds: number }>("stop_recording"),
  status: () => invoke<RecStatus>("get_recording_status"),
  onLevel: (cb: (level: number) => void) =>
    listen<{ level: number }>("audio-level", (e) => cb(e.payload?.level ?? 0)),
};

// Calendar (spec 07): the Mac's calendars through EventKit.
export type CalAccess = "not_asked" | "denied" | "restricted" | "granted" | "add_only";
export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  video: boolean;
  platform?: string | null;
  folder: string;
  matches: boolean;
}
export interface AutoRecord {
  enabled: boolean;
  ask_first: boolean;
  min_attendees: number;
  video_only: boolean;
}
export const calendar = {
  access: () => invoke<CalAccess>("calendar_access"),
  requestAccess: () => invoke<CalAccess>("calendar_request_access"),
  upcoming: (hours = 24) => invoke<CalEvent[]>("calendar_upcoming", { hours }),
  getAutoRecord: () => invoke<AutoRecord>("autorecord_get"),
  setAutoRecord: (cfg: AutoRecord) => invoke<AutoRecord>("autorecord_set", { cfg }),
};
