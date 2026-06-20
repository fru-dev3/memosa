// Typed IPC client for the files-only vault (spec 09). The UI talks to the vault
// only through these wrappers — never the filesystem directly.
import { invoke } from "@tauri-apps/api/core";

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
  tags: string[];
  source: string;
  audio: string;
  updated?: string;
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

  // provided by the migration module (workflow)
  migrate: () => invoke<{ conversations: number; audio_copied: number; skipped: number; errors: string[] }>(
    "vault_migrate_run",
  ),
};
