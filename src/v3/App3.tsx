// Memosa 3.0 UI (spec 11), wired to the files-only vault and the existing recorder.
// The legacy app stays reachable with ?ui=legacy (see main.tsx).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "./icons";
import { EntityHeader, LinkEditor } from "./Links";
import {
  calendar,
  recorder,
  vault,
  type AutoRecord,
  type CalAccess,
  type CalEvent,
  type Directory,
  type Entity,
  type LinkKind,
  type Links,
  type AskAnswer,
  type ConvBundle,
  type ConvMeta,
  type SearchHit,
  type Task,
  type Transcript,
  type TreeNode,
} from "../lib/vault";
import type { AppSettings, ModelInfo } from "../lib/types";
import "./v3.css";

type Screen = "library" | "search" | "tasks" | "ask" | "settings";
type Tab = "summary" | "transcript" | "speakers" | "actions";
type ThemePref = "auto" | "daylight" | "vault";
type Toast = { kind: "ok" | "err"; text: string } | null;
type CalPrompt = { event: CalEvent; folder: string } | null;
type LinkFilter = { kind: LinkKind; name: string } | null;
type Prompt = { title: string; label: string; value: string; submitLabel: string; submit: (v: string) => void } | null;

const THEME_KEY = "memosa.theme";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fmtClock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const fmtMins = (sec: number) => (sec <= 0 ? "No length yet" : sec < 60 ? "under 1 min" : `${Math.round(sec / 60)} min`);
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};
const linksOf = (m: ConvMeta): Links => ({ people: m.people ?? [], accounts: m.accounts ?? [], tags: m.tags ?? [] });
const prettyName = (n: string) => n.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");
const parentOf = (id: string) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");
const crumbText = (id: string) => parentOf(id).split("/").filter(Boolean).join(" / ");

function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "auto" || v === "daylight" || v === "vault") return v;
  } catch {
    /* storage unavailable: fall through */
  }
  return "auto";
}

function flattenConvs(node: TreeNode | null, out: TreeNode[] = []): TreeNode[] {
  if (!node) return out;
  if (node.kind === "conversation") out.push(node);
  node.children?.forEach((c) => flattenConvs(c, out));
  return out;
}

function flattenFolders(node: TreeNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind !== "conversation" && node.path) out.push(node.path);
  node.children?.forEach((c) => flattenFolders(c, out));
  return out;
}

// ---- recursive folder tree ----
function Tree({
  node,
  depth,
  onOpenFolder,
  onOpenConv,
  onAddSub,
  selected,
}: {
  node: TreeNode;
  depth: number;
  onOpenFolder: (p: string) => void;
  onOpenConv: (id: string) => void;
  onAddSub: (parent: string) => void;
  selected: string | null;
}) {
  const [collapsed, setCollapsed] = useState(depth >= 2);
  const isConv = node.kind === "conversation";
  const hasKids = (node.children?.length ?? 0) > 0;
  return (
    <div>
      <div
        className={"v3-twig " + (isConv ? "file " : "folder ") + (selected === node.path ? "on" : "")}
        onClick={() => (isConv ? onOpenConv(node.path) : onOpenFolder(node.path))}
        title={isConv ? prettyName(node.name) : node.name}
      >
        {isConv || !hasKids ? (
          <span className="v3-gap" />
        ) : (
          <span
            className={"v3-caret " + (collapsed ? "col" : "")}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
          >
            <Icon name="caret" size={13} />
          </span>
        )}
        <span className="ico">
          <Icon name={isConv ? "file" : depth === 0 ? "domain" : "folder"} size={isConv ? 13 : 15} />
        </span>
        <span className="nm">{isConv ? prettyName(node.name) : node.name}</span>
        {!isConv && (
          <>
            {typeof node.count === "number" && <span className="ct">{node.count}</span>}
            <span
              className="addsub"
              title="New subfolder"
              onClick={(e) => {
                e.stopPropagation();
                onAddSub(node.path);
              }}
            >
              <Icon name="plus" size={13} />
            </span>
          </>
        )}
      </div>
      {!collapsed && hasKids && (
        <div className="v3-sub">
          {node.children!.map((c) => (
            <Tree
              key={c.path}
              node={c}
              depth={depth + 1}
              onOpenFolder={onOpenFolder}
              onOpenConv={onOpenConv}
              onAddSub={onAddSub}
              selected={selected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={"v3-switch " + (on ? "on" : "")} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export default function App3() {
  const [themePref, setThemePref] = useState<ThemePref>(readThemePref);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [screen, setScreen] = useState<Screen>("library");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [folder, setFolder] = useState("");
  const [dir, setDir] = useState<Directory | null>(null);
  const [linkFilter, setLinkFilter] = useState<LinkFilter>(null);
  const [railOpen, setRailOpen] = useState<Record<string, boolean>>({ person: true, account: true, tag: true });
  const [list, setList] = useState<ConvMeta[]>([]);
  const [conv, setConv] = useState<ConvBundle | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<"semantic" | "exact">("exact");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [askQ, setAskQ] = useState("");
  const [ans, setAns] = useState<AskAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [vpath, setVpath] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palQ, setPalQ] = useState("");
  const [menu, setMenu] = useState<"export" | "more" | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [dl, setDl] = useState<Record<string, number>>({});
  const [aiStatus, setAiStatus] = useState<string>("");
  const [mcpConfig, setMcpConfig] = useState("");
  const [indexInfo, setIndexInfo] = useState<{ chunks: number; stale: number; conversations: number } | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [audioDur, setAudioDur] = useState(0);
  const [defaultVault, setDefaultVault] = useState("");
  const [calAccess, setCalAccess] = useState<CalAccess | null>(null);
  const [autoRec, setAutoRec] = useState<AutoRecord | null>(null);
  const [upcoming, setUpcoming] = useState<CalEvent[]>([]);
  const [calPrompt, setCalPrompt] = useState<CalPrompt>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handledEvents = useRef<Set<string>>(new Set());
  const recTimer = useRef<number | null>(null);
  const folderRef = useRef("");
  const filterRef = useRef<LinkFilter>(null);
  const recStarted = useRef(0);
  const convIdRef = useRef<string | null>(null);

  const theme = themePref === "auto" ? (systemDark ? "vault" : "daylight") : themePref;

  // ---- theme ----
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, themePref);
    } catch {
      /* not persisted: fine */
    }
  }, [themePref]);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  const flash = useCallback((kind: "ok" | "err", text: string) => setToast({ kind, text }), []);
  useEffect(() => {
    if (!toast || toast.kind === "err") return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);
  const fail = useCallback((e: unknown) => flash("err", String(e)), [flash]);
  const setBusyKey = (k: string, v: boolean) => setBusy((b) => ({ ...b, [k]: v }));
  const setNote = (k: string, v: string) => setNotes((n) => ({ ...n, [k]: v }));

  // ---- data loading ----
  const loadList = useCallback((t: TreeNode | null, path: string) => {
    const f = filterRef.current;
    if (f) {
      vault.linked(f.kind, f.name).then(setList).catch(() => setList([]));
      return;
    }
    if (!t) return;
    const convs: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      if (n.kind === "conversation" && (path === "" || n.path === path || n.path.startsWith(path + "/"))) convs.push(n);
      n.children?.forEach(walk);
    };
    walk(t);
    Promise.all(convs.map((c) => vault.get(c.path).then((b) => b.meta).catch(() => null))).then((ms) =>
      setList((ms.filter(Boolean) as ConvMeta[]).sort((a, b) => b.created.localeCompare(a.created))),
    );
  }, []);

  const loadConv = useCallback((id: string) => {
    convIdRef.current = id;
    vault
      .audioPath(id)
      .then((p) => convIdRef.current === id && setAudioSrc(p ? convertFileSrc(p) : null))
      .catch(() => setAudioSrc(null));
    return vault
      .get(id)
      .then((b) => {
        if (convIdRef.current === id) setConv(b);
      })
      .catch(() => {
        if (convIdRef.current === id) {
          convIdRef.current = null;
          setConv(null);
        }
      });
  }, []);

  // Re-read everything from disk (the vault is the source of truth).
  const reloadAll = useCallback(() => {
    vault
      .tree()
      .then((t) => {
        setTree(t);
        loadList(t, folderRef.current);
      })
      .catch(fail);
    vault.tasks("all").then(setTasks).catch(() => {});
    vault.directory().then(setDir).catch(() => {});
    if (convIdRef.current) {
      const id = convIdRef.current;
      loadConv(id);
      vault.transcript(id).then((t) => convIdRef.current === id && setTranscript(t)).catch(() => {});
    }
  }, [loadList, loadConv, fail]);

  useEffect(() => {
    reloadAll();
    vault.path().then(setVpath).catch(() => {});
    vault.defaultPath().then(setDefaultVault).catch(() => {});
    // The backend watches the vault folder (FSEvents): any change on disk, from this
    // app, Finder, another AI or a sync tool, refreshes the views.
    const un = vault.onChanged(() => reloadAll());
    return () => void un.then((f) => f());
  }, [reloadAll]);

  const loadSettingsScreen = useCallback(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(fail);
    invoke<ModelInfo[]>("get_available_models").then(setModels).catch(() => {});
    invoke<{ available: boolean; detail: string }>("get_insight_engine_status").then((s) => setAiStatus(s.detail)).catch(() => {});
    vault.mcpInfo().then((i) => setMcpConfig(i.config)).catch(() => {});
    vault.embeddingStatus().then(setIndexInfo).catch(() => {});
    calendar.access().then(setCalAccess).catch(() => {});
    calendar.getAutoRecord().then(setAutoRec).catch(() => {});
    calendar.upcoming().then(setUpcoming).catch(() => {});
  }, [fail]);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(() => {});
  }, []);
  useEffect(() => {
    if (screen === "settings") loadSettingsScreen();
  }, [screen, loadSettingsScreen]);

  // Whisper model download progress.
  useEffect(() => {
    const subs = [
      listen<{ model: string; progress: number }>("model-download-progress", (e) =>
        setDl((d) => ({ ...d, [e.payload.model]: e.payload.progress })),
      ),
      listen<{ model: string }>("model-download-complete", (e) => {
        setDl((d) => {
          const n = { ...d };
          delete n[e.payload.model];
          return n;
        });
        invoke<ModelInfo[]>("get_available_models").then(setModels).catch(() => {});
      }),
      listen<{ model: string; error?: string }>("model-download-failed", (e) => {
        setDl((d) => {
          const n = { ...d };
          delete n[e.payload.model];
          return n;
        });
        flash("err", `Download of ${e.payload.model} failed${e.payload.error ? ": " + e.payload.error : "."}`);
      }),
    ];
    return () => subs.forEach((p) => p.then((un) => un()));
  }, [flash]);

  const saveSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      if (!settings) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      invoke("save_settings", { settings: next })
        .then(() =>
          invoke<{ detail: string }>("get_insight_engine_status").then((s) => setAiStatus(s.detail)).catch(() => {}),
        )
        .catch(fail);
    },
    [settings, fail],
  );

  // ---- navigation ----
  const openFolder = useCallback(
    (path: string) => {
      filterRef.current = null;
      setLinkFilter(null);
      folderRef.current = path;
      setFolder(path);
      setScreen("library");
      loadList(tree, path);
    },
    [tree, loadList],
  );

  // Show a conversation in the detail pane, leaving the list as it is.
  const selectConv = useCallback(
    (id: string) => {
      setScreen("library");
      setTab("summary");
      setTranscript(null);
      setMenu(null);
      loadConv(id);
    },
    [loadConv],
  );

  const openConv = useCallback(
    (id: string) => {
      const parent = parentOf(id);
      filterRef.current = null;
      setLinkFilter(null);
      folderRef.current = parent;
      setFolder(parent);
      loadList(tree, parent);
      selectConv(id);
    },
    [tree, loadList, selectConv],
  );

  // Every call with a person, an account (and its people) or a #tag.
  const openLinked = useCallback(
    (kind: LinkKind, name: string) => {
      const f = { kind, name };
      filterRef.current = f;
      setLinkFilter(f);
      setScreen("library");
      loadList(tree, "");
    },
    [tree, loadList],
  );

  const saveLinks = useCallback(
    (l: Links) => {
      if (!conv) return;
      const id = conv.meta.id;
      setConv((c) => (c && c.meta.id === id ? { ...c, meta: { ...c.meta, ...l } } : c));
      vault
        .setLinks(id, l)
        .then((meta) => {
          setConv((c) => (c && c.meta.id === id ? { ...c, meta } : c));
          vault.directory().then(setDir).catch(() => {});
        })
        .catch(fail);
    },
    [conv, fail],
  );

  const answerSuggestion = useCallback(
    (kind: LinkKind, name: string, accept: boolean) => {
      if (!conv) return;
      const id = conv.meta.id;
      vault
        .answerSuggestion(id, kind, name, accept)
        .then((meta) => {
          setConv((c) => (c && c.meta.id === id ? { ...c, meta } : c));
          vault.directory().then(setDir).catch(() => {});
        })
        .catch(fail);
    },
    [conv, fail],
  );

  const suggestLinks = useCallback(() => {
    if (!conv) return;
    const id = conv.meta.id;
    setBusyKey("suggest", true);
    vault
      .suggest(id)
      .then((meta) => {
        setConv((c) => (c && c.meta.id === id ? { ...c, meta } : c));
        const n = (meta.suggested?.people.length ?? 0) + (meta.suggested?.accounts.length ?? 0) + (meta.suggested?.tags.length ?? 0);
        flash("ok", n ? `${n} suggestions. Tap the tick to keep one.` : "Nothing new to suggest.");
      })
      .catch(fail)
      .finally(() => setBusyKey("suggest", false));
  }, [conv, flash, fail]);

  const linkedEntity: (Entity & { count: number }) | null = useMemo(
    () =>
      linkFilter && linkFilter.kind !== "tag"
        ? dir?.entities.find((e) => e.kind === linkFilter.kind && e.name === linkFilter.name) ?? null
        : null,
    [dir, linkFilter],
  );

  const saveEntity = useCallback(
    (e: Entity, oldName?: string) =>
      vault
        .saveEntity(e, oldName)
        .then(() => {
          if (oldName && oldName !== e.name && filterRef.current) {
            filterRef.current = { kind: e.kind, name: e.name };
            setLinkFilter(filterRef.current);
          }
          reloadAll();
        })
        .catch(fail),
    [reloadAll, fail],
  );

  useEffect(() => {
    if ((tab === "transcript" || tab === "speakers") && conv && !transcript) {
      const id = conv.meta.id;
      vault.transcript(id).then((t) => convIdRef.current === id && setTranscript(t)).catch(() => {});
    }
  }, [tab, conv, transcript]);

  // ---- search / ask ----
  const runSearch = useCallback(
    (q: string, mode: "semantic" | "exact") => {
      if (!q.trim()) return setHits(null);
      setSearching(true);
      vault
        .search(q, mode)
        .then(setHits)
        .catch(fail)
        .finally(() => setSearching(false));
    },
    [fail],
  );

  const runAsk = useCallback(
    (q: string) => {
      if (!q.trim()) return;
      setAskQ(q);
      setScreen("ask");
      setAsking(true);
      setAns(null);
      vault
        .ask(q)
        .then(setAns)
        .catch(fail)
        .finally(() => setAsking(false));
    },
    [fail],
  );

  // ---- tasks ----
  const toggleTask = useCallback(
    (t: Task) => {
      const done = !t.done;
      const same = (x: Task) => x.conv === t.conv && x.text === t.text;
      // optimistic
      setTasks((ts) => ts.map((x) => (same(x) ? { ...x, done } : x)));
      setConv((c) =>
        c && c.meta.id === t.conv
          ? { ...c, notes: { ...c.notes, actions: c.notes.actions.map((a) => (a.text === t.text ? { ...a, done } : a)) } }
          : c,
      );
      vault.toggleTask(t.conv, t.text, done).catch((e) => {
        fail(e);
        reloadAll();
      });
    },
    [fail, reloadAll],
  );

  // ---- folders / conversations ----
  const askName = (title: string, label: string, submitLabel: string, value: string, submit: (v: string) => void) =>
    setPrompt({ title, label, value, submitLabel, submit });

  const addDomain = useCallback(() => {
    askName("New domain", "Name", "Create", "", (name) =>
      vault
        .createFolder(name)
        .then(() => {
          reloadAll();
          flash("ok", `Created ${name}.`);
        })
        .catch(fail),
    );
  }, [reloadAll, flash, fail]);

  const addSubfolder = useCallback(
    (parent: string) => {
      askName(`New folder in ${parent.split("/").join(" / ")}`, "Name", "Create", "", (name) =>
        vault
          .createFolder(`${parent}/${name}`)
          .then(() => {
            reloadAll();
            flash("ok", `Created ${name}.`);
          })
          .catch(fail),
      );
    },
    [reloadAll, flash, fail],
  );

  const renameConv = useCallback(() => {
    if (!conv) return;
    const id = conv.meta.id;
    askName("Rename conversation", "Title", "Rename", conv.meta.title, (title) =>
      vault
        .rename(id, title)
        .then((newId) => {
          convIdRef.current = newId;
          reloadAll();
          flash("ok", "Renamed.");
        })
        .catch(fail),
    );
  }, [conv, reloadAll, flash, fail]);

  const moveConv = useCallback(
    (dest: string) => {
      if (!conv) return;
      setMoveOpen(false);
      vault
        .move(conv.meta.id, dest)
        .then((newId) => {
          convIdRef.current = newId;
          folderRef.current = dest;
          setFolder(dest);
          reloadAll();
          flash("ok", `Moved to ${dest.split("/").join(" / ")}.`);
        })
        .catch(fail);
    },
    [conv, reloadAll, flash, fail],
  );

  const deleteConv = useCallback(() => {
    if (!conv) return;
    setConfirmDelete(false);
    vault
      .remove(conv.meta.id)
      .then(() => {
        convIdRef.current = null;
        setConv(null);
        reloadAll();
        flash("ok", "Moved to the vault trash (.memosa/trash).");
      })
      .catch(fail);
  }, [conv, reloadAll, flash, fail]);

  // ---- capture ----
  // Files into the open folder (or a calendar event's folder); Recordings otherwise.
  const startCapture = useCallback(
    (opts?: { title?: string; folder?: string; people?: string[]; eventId?: string }) => {
    if (recording) return;
    const title =
      opts?.title ||
      `Recording ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    const folder = opts?.folder || (screen === "library" ? folderRef.current : "");
    // Recording from a person, account or #tag page files the call with it.
    const f = screen === "library" && !opts?.folder ? filterRef.current : null;
    const people = [...(opts?.people ?? []), ...(f?.kind === "person" ? [f.name] : [])];
    const accounts = f?.kind === "account" ? [f.name] : [];
    const tags = f?.kind === "tag" ? [f.name] : [];
    vault
      .setCaptureTarget({ folder, people, accounts, tags, eventId: opts?.eventId })
      .then(() => recorder.start(title))
      .then(() => {
        setRecording(true);
        setRecSec(0);
        recStarted.current = Date.now();
        recTimer.current = window.setInterval(() => setRecSec(Math.round((Date.now() - recStarted.current) / 1000)), 1000);
        // The floating recorder: the main window can be put away during the call.
        invoke("pill_show", { started: recStarted.current, title }).catch(() => {});
      })
      .catch((e) => flash("err", "Couldn't start recording: " + String(e)));
    },
    [recording, screen, flash],
  );

  const stopCapture = useCallback(() => {
    if (recTimer.current) window.clearInterval(recTimer.current);
    recorder
      .stop()
      .then(() => {
        setRecording(false);
        invoke("pill_close").catch(() => {});
        flash("ok", "Saved to your vault. Transcribing on this Mac.");
        reloadAll();
      })
      .catch((e) => {
        setRecording(false);
        invoke("pill_close").catch(() => {});
        flash("err", "Couldn't stop recording: " + String(e));
      });
  }, [reloadAll, flash]);

  // Stop pressed on the floating recorder.
  useEffect(() => {
    if (!recording) return;
    const un = listen("pill-stop", () => stopCapture());
    return () => void un.then((f) => f());
  }, [recording, stopCapture]);

  const importAudio = useCallback(async () => {
    try {
      const src = await vault.pickAudio();
      if (!src) return;
      const dest = folderRef.current || "Imported";
      setBusyKey("import", true);
      flash("ok", "Importing and transcribing on this Mac.");
      const id = await vault.importAudio(src, dest);
      reloadAll();
      openConv(id);
      flash("ok", "Imported.");
    } catch (e) {
      fail(e);
    } finally {
      setBusyKey("import", false);
    }
  }, [reloadAll, openConv, flash, fail]);

  const transcribeConv = useCallback(() => {
    if (!conv) return;
    const id = conv.meta.id;
    setBusyKey("transcribe", true);
    vault
      .transcribe(id)
      .then(() => {
        setTranscript(null);
        reloadAll();
        flash("ok", "Transcribed.");
      })
      .catch(fail)
      .finally(() => setBusyKey("transcribe", false));
  }, [conv, reloadAll, flash, fail]);

  const runMigrate = useCallback(() => {
    setBusyKey("migrate", true);
    setNote("migrate", "");
    vault
      .migrate()
      .then((r) => {
        setNote(
          "migrate",
          `Imported ${r.conversations} conversations (${r.audio_copied} with audio, ${r.skipped} already here)` +
            (r.errors.length ? `, ${r.errors.length} errors.` : "."),
        );
        reloadAll();
      })
      .catch((e) => setNote("migrate", "Import failed: " + String(e)))
      .finally(() => setBusyKey("migrate", false));
  }, [reloadAll]);

  const runReindex = useCallback(() => {
    setBusyKey("index", true);
    setNote("index", "");
    vault
      .reindex()
      .then((n) => {
        setNote("index", `Indexed ${n} passages for search by meaning.`);
        vault.embeddingStatus().then(setIndexInfo).catch(() => {});
      })
      .catch((e) => setNote("index", "Indexing needs local AI with an embedding model. " + String(e)))
      .finally(() => setBusyKey("index", false));
  }, []);

  const summarizeConv = useCallback(() => {
    if (!conv) return;
    const id = conv.meta.id;
    setBusyKey("summarize", true);
    vault
      .summarize(id)
      .then(() => {
        reloadAll();
        flash("ok", "Notes written to notes.md.");
      })
      .catch(fail)
      .finally(() => setBusyKey("summarize", false));
  }, [conv, reloadAll, flash, fail]);

  const syncNow = useCallback(() => {
    setBusyKey("sync", true);
    vault
      .syncNow()
      .then((r) => setNote("sync", r.message))
      .catch((e) => setNote("sync", String(e)))
      .finally(() => setBusyKey("sync", false));
  }, []);

  const changeVault = useCallback(async () => {
    try {
      const picked = await vault.pickFolder();
      if (picked) {
        await vault.setPath(picked);
        setVpath(picked);
        convIdRef.current = null;
        setConv(null);
        folderRef.current = "";
        setFolder("");
        reloadAll();
        flash("ok", "Vault location changed.");
      }
    } catch (e) {
      fail(e);
    }
  }, [reloadAll, flash, fail]);

  const resetVault = useCallback(() => {
    vault
      .resetPath()
      .then((p) => {
        setVpath(p);
        convIdRef.current = null;
        setConv(null);
        folderRef.current = "";
        setFolder("");
        reloadAll();
        flash("ok", "Using the default vault location.");
      })
      .catch(fail);
  }, [reloadAll, flash, fail]);

  // ---- calendar auto-record (spec 07) ----
  const saveAutoRec = useCallback(
    (patch: Partial<AutoRecord>) => {
      if (!autoRec) return;
      const next = { ...autoRec, ...patch };
      setAutoRec(next);
      calendar
        .setAutoRecord(next)
        .then(() => calendar.upcoming().then(setUpcoming))
        .catch(fail);
    },
    [autoRec, fail],
  );

  const askCalendar = useCallback(() => {
    calendar
      .requestAccess()
      .then((a) => {
        setCalAccess(a);
        if (a === "granted") calendar.upcoming().then(setUpcoming).catch(() => {});
      })
      .catch(fail);
  }, [fail]);

  useEffect(() => {
    calendar.getAutoRecord().then(setAutoRec).catch(() => {});
  }, []);

  // Every 30 s: a selected meeting starting within a minute is offered (ask first)
  // or recorded straight away. Each meeting is handled once; declining records nothing.
  useEffect(() => {
    if (!autoRec?.enabled) return;
    const tick = () => {
      if (recording || calPrompt) return;
      calendar
        .upcoming(1)
        .then((events) => {
          const now = Date.now();
          const due = events.find((e) => {
            const t = new Date(e.start).getTime() - now;
            return e.matches && t <= 60_000 && t > -5 * 60_000 && !handledEvents.current.has(e.id);
          });
          if (!due) return;
          handledEvents.current.add(due.id);
          if (autoRec.ask_first) setCalPrompt({ event: due, folder: due.folder });
          else startCapture({ title: due.title, folder: due.folder, people: due.attendees, eventId: due.id });
        })
        .catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, [autoRec, recording, calPrompt, startCapture]);

  // ---- audio player ----
  const seek = useCallback((sec: number, play = true) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = sec;
    setCurTime(sec);
    if (play) a.play().catch(() => {});
  }, []);
  useEffect(() => {
    setPlaying(false);
    setCurTime(0);
    setAudioDur(0);
  }, [audioSrc]);

  const copyText = useCallback(
    (text: string, done: string) => {
      navigator.clipboard.writeText(text).then(() => flash("ok", done)).catch(fail);
    },
    [flash, fail],
  );

  // ---- keyboard: Cmd+K palette, Cmd+R record, Esc close ----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalQ("");
        setPaletteOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (recording) stopCapture();
        else startCapture();
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setMenu(null);
        setModeOpen(false);
        setMoveOpen(false);
        setConfirmDelete(false);
        setPrompt(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [recording, startCapture, stopCapture]);

  const allConvs = useMemo(() => flattenConvs(tree), [tree]);
  const allFolders = useMemo(() => flattenFolders(tree), [tree]);
  const palConvs = useMemo(
    () => allConvs.filter((c) => prettyName(c.name).toLowerCase().includes(palQ.toLowerCase())).slice(0, 6),
    [allConvs, palQ],
  );
  const openTasks = tasks.filter((t) => !t.done);
  const sortedTasks = useMemo(() => [...tasks.filter((t) => !t.done), ...tasks.filter((t) => t.done)], [tasks]);
  const crumb = useMemo(() => folder.split("/").filter(Boolean), [folder]);
  const isEmpty = !!tree && (tree.children?.length ?? 0) === 0;
  const speakers = transcript ? Object.values(transcript.speakers) : [];
  const mode = settings?.app_mode ?? "bunker";
  const localAI = settings?.insight_engine === "ollama";
  const hasModel = models.some((m) => m.downloaded);
  // Ollama can live on another machine; only claim "on this Mac" when it does not.
  const aiHost = (() => {
    try {
      return new URL(settings?.ollama_url || "http://localhost").hostname;
    } catch {
      return "localhost";
    }
  })();
  const aiIsLocal = !localAI || ["localhost", "::1", "[::1]"].includes(aiHost) || aiHost.startsWith("127.");
  const usingDefaultVault = !vpath || vpath === defaultVault;

  const palAction = (fn: () => void) => () => {
    setPaletteOpen(false);
    fn();
  };

  return (
    <div className="v3">
      {/* titlebar */}
      <div className="v3-bar" data-tauri-drag-region>
        <div className="v3-wordmark" data-tauri-drag-region>
          <span className="v3-logo">
            <Icon name="logo" size={13} />
          </span>
          Memosa
        </div>
        <button
          className="v3-omni"
          onClick={() => {
            setPalQ("");
            setPaletteOpen(true);
          }}
        >
          <Icon name="search" size={15} />
          <span className="lbl">Search or ask your conversations</span>
          <span className="kbd">⌘K</span>
        </button>
        <div className="v3-right">
          <button className="v3-mode" onClick={() => setModeOpen(true)} title="Privacy mode">
            <Icon name={mode === "bunker" ? "lock" : "cloud"} size={14} /> {mode === "bunker" ? "Bunker" : "Cloud"}
          </button>
          <button
            className="v3-ghost"
            title={`Theme: ${themePref === "auto" ? "Auto" : themePref === "daylight" ? "Daylight" : "Vault"}`}
            onClick={() => setThemePref(theme === "daylight" ? "vault" : "daylight")}
          >
            <Icon name="theme" size={17} />
          </button>
        </div>
      </div>

      <div className="v3-body">
        {/* rail */}
        <nav className="v3-rail">
          {(["library", "ask", "search", "tasks"] as Screen[]).map((s) => (
            <button
              key={s}
              className={"v3-nav " + (screen === s ? "active" : "")}
              onClick={() => {
                if (s === "library") {
                  folderRef.current = "";
                  setFolder("");
                  loadList(tree, "");
                }
                setScreen(s);
              }}
            >
              <Icon name={s} size={16} />
              {s === "library" ? "Library" : s === "ask" ? "Ask" : s === "search" ? "Search" : "Tasks"}
              {s === "tasks" && openTasks.length > 0 && <span className="badge">{openTasks.length}</span>}
            </button>
          ))}

          <div className="v3-ghdr-row">
            <span>Domains</span>
            <button className="v3-add" title="New domain" onClick={addDomain}>
              <Icon name="plus" size={15} />
            </button>
          </div>
          {tree?.children?.map((c) => (
            <Tree
              key={c.path}
              node={c}
              depth={0}
              onOpenFolder={openFolder}
              onOpenConv={openConv}
              onAddSub={addSubfolder}
              selected={conv?.meta.id ?? null}
            />
          ))}
          {isEmpty && (
            <button className="v3-railempty" onClick={addDomain}>
              No domains yet. <b>New domain</b>
            </button>
          )}

          {(
            [
              ["person", "People", (dir?.entities ?? []).filter((e) => e.kind === "person")],
              ["account", "Accounts", (dir?.entities ?? []).filter((e) => e.kind === "account")],
              ["tag", "Tags", dir?.tags ?? []],
            ] as [LinkKind, string, { name: string; count: number }[]][]
          ).map(([kind, label, rows]) =>
            rows.length === 0 ? null : (
              <div key={kind}>
                <button className="v3-ghdr-row btn" onClick={() => setRailOpen((o) => ({ ...o, [kind]: !o[kind] }))}>
                  <span>{label}</span>
                  <span className="ct">{railOpen[kind] ? "" : rows.length}</span>
                </button>
                {railOpen[kind] &&
                  rows.map((r) => (
                    <div
                      key={r.name}
                      className={"v3-twig " + (linkFilter?.kind === kind && linkFilter.name === r.name && screen === "library" ? "on" : "")}
                      onClick={() => openLinked(kind, r.name)}
                      title={r.name}
                    >
                      <span className="ico">
                        <Icon name={kind} size={14} />
                      </span>
                      <span className="nm">{kind === "tag" ? "#" + r.name : r.name}</span>
                      <span className="ct">{r.count}</span>
                    </div>
                  ))}
              </div>
            ),
          )}

          <div className="v3-spacer" />
          <button className={"v3-capture " + (recording ? "rec" : "")} onClick={() => (recording ? stopCapture() : startCapture())}>
            <Icon name={recording ? "stop" : "capture"} size={16} />
            {recording ? `Stop ${fmtClock(recSec)}` : "Capture"}
            <span className="kbd">⌘R</span>
          </button>
          <button className={"v3-nav " + (screen === "settings" ? "active" : "")} onClick={() => setScreen("settings")}>
            <Icon name="settings" size={16} /> Settings
          </button>
        </nav>

        {/* stage */}
        <main className={"v3-stage " + (screen === "library" && !isEmpty ? "v3-library" : "")}>
          {/* EMPTY / FIRST RUN */}
          {isEmpty && screen === "library" && (
            <div className="v3-hero">
              <div className="v3-heroin">
                <div className="v3-bigmark">
                  <Icon name="logo" size={32} />
                </div>
                <h1>Your memory starts here.</h1>
                <div className="sub">Record a conversation or import audio. Memosa files it as plain folders and text on your Mac.</div>
                <div className="v3-herocta">
                  <button className="v3-btnbig primary" onClick={() => startCapture()}>
                    <Icon name="capture" size={18} /> Start recording
                  </button>
                  <button className="v3-btnbig ghost" onClick={importAudio} disabled={busy.import}>
                    <Icon name="upload" size={18} /> {busy.import ? "Importing" : "Import audio"}
                  </button>
                </div>
                <div className="v3-herofeat">
                  <div>
                    <Icon name="folder" size={18} />
                    <b>Plain files</b>
                    <span>Every conversation is a folder you own.</span>
                  </div>
                  <div>
                    <Icon name="lock" size={18} />
                    <b>Local AI</b>
                    <span>Transcripts and answers stay on this Mac.</span>
                  </div>
                  <div>
                    <Icon name="plug" size={18} />
                    <b>Open to your AI</b>
                    <span>Point Claude or Cursor at the vault.</span>
                  </div>
                </div>
                <div className="v3-herovault">
                  <Icon name="folder" size={15} />
                  <span className="mono">{vpath}</span>
                  <button className="v3-link inline" onClick={changeVault}>
                    Change
                  </button>
                </div>
                <button className="v3-link" onClick={() => setScreen("settings")}>
                  Used Memosa before? Bring your recordings over in Settings.
                </button>
              </div>
            </div>
          )}

          {/* LIBRARY */}
          {screen === "library" && !isEmpty && (
            <>
              <section className="v3-list">
                {linkFilter && (
                  <EntityHeader
                    key={linkFilter.kind + linkFilter.name}
                    filter={linkFilter}
                    entity={linkedEntity}
                    accounts={(dir?.entities ?? []).filter((e) => e.kind === "account").map((e) => e.name)}
                    onOpen={openLinked}
                    onSave={saveEntity}
                    onAll={() => openFolder("")}
                    count={list.length}
                  />
                )}
                <div className="v3-listhead" hidden={!!linkFilter}>
                  <div className="v3-crumb">
                    {crumb.length === 0 ? (
                      <b>All conversations</b>
                    ) : (
                      <>
                        <button onClick={() => openFolder("")}>All</button>
                        {crumb.map((c, i) => (
                          <React.Fragment key={i}>
                            <Icon name="chevron" size={13} />
                            {i === crumb.length - 1 ? (
                              <b>{c}</b>
                            ) : (
                              <button onClick={() => openFolder(crumb.slice(0, i + 1).join("/"))}>{c}</button>
                            )}
                          </React.Fragment>
                        ))}
                      </>
                    )}
                  </div>
                  <button className="v3-ghost sm" title={`Import audio into ${folder || "Imported"}`} onClick={importAudio} disabled={busy.import}>
                    <Icon name="upload" size={16} />
                  </button>
                </div>
                {!linkFilter && (
                  <div className="v3-listsub">
                    {list.length} {list.length === 1 ? "conversation" : "conversations"}
                  </div>
                )}
                {list.length === 0 && <div className="v3-empty">No conversations here yet.</div>}
                {list.map((m) => (
                  <button key={m.id} className={"v3-row " + (conv?.meta.id === m.id ? "sel" : "")} onClick={() => (linkFilter ? selectConv(m.id) : openConv(m.id))}>
                    <div>
                      <div className="title">{m.title}</div>
                      <div className="meta">
                        {fmtMins(m.duration_sec)}
                        {[...m.people.slice(0, 2), ...(m.accounts ?? []).slice(0, 1)].map((x) => ", " + x).join("")}
                      </div>
                    </div>
                    <span className="time">{fmtDate(m.created)}</span>
                  </button>
                ))}
              </section>

              <section className="v3-detail">
                {!conv ? (
                  <div className="v3-empty" style={{ marginTop: 80 }}>
                    Select a conversation, or press Capture to record one.
                  </div>
                ) : (
                  <div className="v3-dinner">
                    <div className="v3-dtop">
                      <span className="v3-kicker">
                        {fmtDate(conv.meta.created)}, {fmtMins(conv.meta.duration_sec)}
                      </span>
                      <div className="v3-actions">
                        <button className="v3-iconbtn" onClick={summarizeConv} disabled={busy.summarize}>
                          <Icon name="spark" size={15} /> {busy.summarize ? "Summarizing" : "Summarize"}
                        </button>
                        <button className="v3-iconbtn" onClick={() => setMenu((m) => (m === "export" ? null : "export"))}>
                          <Icon name="download" size={15} /> Export
                        </button>
                        <button className="v3-iconbtn icon" title="More" onClick={() => setMenu((m) => (m === "more" ? null : "more"))}>
                          <Icon name="dots" size={16} />
                        </button>
                      </div>
                    </div>
                    {menu === "export" && (
                      <div className="v3-menu" onMouseLeave={() => setMenu(null)}>
                        <button
                          className="v3-mi"
                          onClick={() => {
                            setMenu(null);
                            vault.exportMarkdown(conv.meta.id).then((md) => copyText(md, "Copied as Markdown.")).catch(fail);
                          }}
                        >
                          <Icon name="copy" size={16} /> Copy as Markdown
                        </button>
                        <button
                          className="v3-mi"
                          onClick={() => {
                            setMenu(null);
                            vault.reveal(conv.meta.id).catch(fail);
                          }}
                        >
                          <Icon name="reveal" size={16} /> Show files in Finder
                        </button>
                      </div>
                    )}
                    {menu === "more" && (
                      <div className="v3-menu" onMouseLeave={() => setMenu(null)}>
                        <button className="v3-mi" onClick={() => { setMenu(null); renameConv(); }}>
                          <Icon name="edit" size={16} /> Rename
                        </button>
                        <button className="v3-mi" onClick={() => { setMenu(null); setMoveOpen(true); }}>
                          <Icon name="folder" size={16} /> Move to folder
                        </button>
                        <button className="v3-mi" onClick={() => { setMenu(null); suggestLinks(); }} disabled={busy.suggest}>
                          <Icon name="spark" size={16} /> {busy.suggest ? "Reading the call" : "Suggest people and tags"}
                        </button>
                        <button className="v3-mi" onClick={() => { setMenu(null); transcribeConv(); }} disabled={busy.transcribe}>
                          <Icon name="doc" size={16} /> {busy.transcribe ? "Transcribing" : "Transcribe again"}
                        </button>
                        <button className="v3-mi danger" onClick={() => { setMenu(null); setConfirmDelete(true); }}>
                          <Icon name="trash" size={16} /> Move to trash
                        </button>
                      </div>
                    )}
                    <h1 className="det">{conv.meta.title}</h1>
                    <div className="v3-foldertag">
                      <Icon name="folder" size={14} /> {crumbText(conv.meta.id) || "Vault"}
                    </div>
                    <LinkEditor
                      key={conv.meta.id}
                      links={linksOf(conv.meta)}
                      suggested={conv.meta.suggested}
                      dir={dir}
                      onChange={saveLinks}
                      onAnswer={answerSuggestion}
                      onOpen={openLinked}
                    />
                    <div className="v3-tabs" role="tablist">
                      {(["summary", "transcript", "speakers", "actions"] as Tab[]).map((t) => (
                        <button key={t} role="tab" aria-selected={tab === t} className={"v3-tab " + (tab === t ? "active" : "")} onClick={() => setTab(t)}>
                          {t === "actions" ? "Action items" : t[0].toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>

                    {tab === "summary" && (
                      <>
                        {conv.notes.summary ? (
                          <p className="lead">{conv.notes.summary}</p>
                        ) : (
                          <p className="v3-hint">
                            No summary yet. Press Summarize to write one on this Mac.
                          </p>
                        )}
                        {conv.notes.decisions.length > 0 && (
                          <>
                            <div className="v3-seclabel">Decisions</div>
                            {conv.notes.decisions.map((d, i) => (
                              <p key={i}>{d}</p>
                            ))}
                          </>
                        )}
                      </>
                    )}

                    {tab === "actions" &&
                      (conv.notes.actions.length === 0 ? (
                        <p className="v3-hint">No action items. Summarize to pull them from the conversation.</p>
                      ) : (
                        conv.notes.actions.map((a, i) => (
                          <button key={i} className={"v3-ai " + (a.done ? "done" : "")} onClick={() => toggleTask({ ...a, conv: conv.meta.id })}>
                            <span className={"v3-check " + (a.done ? "done" : "")}>{a.done && <Icon name="check" size={12} />}</span>
                            <div>
                              <div className="txt">{a.text}</div>
                              {(a.owner || a.due) && <div className="v3-owner">{[a.owner, a.due].filter(Boolean).join(", ")}</div>}
                            </div>
                          </button>
                        ))
                      ))}

                    {tab === "transcript" && audioSrc && (
                      <div className="v3-player">
                        <audio
                          ref={audioRef}
                          src={audioSrc}
                          preload="metadata"
                          onLoadedMetadata={(e) => setAudioDur(e.currentTarget.duration || 0)}
                          onTimeUpdate={(e) => setCurTime(e.currentTarget.currentTime)}
                          onPlay={() => setPlaying(true)}
                          onPause={() => setPlaying(false)}
                          onEnded={() => setPlaying(false)}
                        />
                        <button
                          className="v3-play"
                          aria-label={playing ? "Pause" : "Play"}
                          onClick={() => {
                            const a = audioRef.current;
                            if (!a) return;
                            if (a.paused) a.play().catch((e) => fail(e));
                            else a.pause();
                          }}
                        >
                          <Icon name={playing ? "pause" : "play"} size={16} />
                        </button>
                        <span className="v3-ptime">{fmtClock(curTime)}</span>
                        <input
                          type="range"
                          aria-label="Position"
                          min={0}
                          max={audioDur || 0}
                          step={0.1}
                          value={Math.min(curTime, audioDur || 0)}
                          onChange={(e) => seek(Number(e.target.value), false)}
                        />
                        <span className="v3-ptime">{fmtClock(audioDur)}</span>
                      </div>
                    )}

                    {tab === "transcript" &&
                      (!transcript ? (
                        <p className="v3-hint">Loading transcript.</p>
                      ) : transcript.segments.length === 0 ? (
                        <div className="v3-hint">
                          <p>No transcript yet. It appears here when local transcription finishes.</p>
                          <button className="v3-iconbtn" onClick={transcribeConv} disabled={busy.transcribe}>
                            <Icon name="doc" size={15} /> {busy.transcribe ? "Transcribing" : "Transcribe now"}
                          </button>
                        </div>
                      ) : (
                        transcript.segments.map((s, i) => (
                          <div
                            key={i}
                            className={"v3-utt " + (audioSrc ? "seekable " : "") + (audioSrc && curTime >= s.start && curTime < s.end ? "now" : "")}
                            title={audioSrc ? "Play from here" : undefined}
                            onClick={() => audioSrc && seek(s.start)}
                          >
                            <div className="ts">{fmtClock(s.start)}</div>
                            <div>
                              {transcript.speakers[s.speaker] && <span className="sp">{transcript.speakers[s.speaker]}</span>}
                              <div className="txt2">{s.text}</div>
                            </div>
                          </div>
                        ))
                      ))}

                    {tab === "speakers" &&
                      (speakers.length === 0 ? (
                        <p className="v3-hint">No speaker labels for this conversation.</p>
                      ) : (
                        <>
                          <div className="v3-seclabel">Speakers</div>
                          {speakers.map((s, i) => (
                            <div key={i} className="v3-ai static">
                              <span className="ico">
                                <Icon name="speaker" size={16} />
                              </span>
                              <div className="txt">{s}</div>
                            </div>
                          ))}
                        </>
                      ))}
                  </div>
                )}
              </section>
            </>
          )}

          {/* SEARCH */}
          {screen === "search" && (
            <div className="v3-col">
              <div className="v3-colin">
                <h1 className="page">Search</h1>
                <div className="v3-bigsearch">
                  <Icon name="search" size={19} />
                  <input
                    autoFocus
                    placeholder="Search your conversations"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch(query, searchMode)}
                  />
                  <div className="v3-modetoggle">
                    {(["semantic", "exact"] as const).map((m) => (
                      <button
                        key={m}
                        className={searchMode === m ? "on" : ""}
                        onClick={() => {
                          setSearchMode(m);
                          runSearch(query, m);
                        }}
                      >
                        {m === "semantic" ? "Meaning" : "Exact"}
                      </button>
                    ))}
                  </div>
                </div>
                {searching && <div className="v3-srxmeta">Searching</div>}
                {hits && !searching && (
                  <div className="v3-srxmeta">
                    {hits.length} {hits.length === 1 ? "result" : "results"}, {searchMode === "semantic" ? "ranked by meaning" : "exact phrase"}
                  </div>
                )}
                {hits && hits.length === 0 && !searching && (
                  <div className="v3-empty">
                    Nothing matched.{searchMode === "exact" ? " Try Meaning to match any of the words." : ""}
                  </div>
                )}
                {!hits && <div className="v3-hint">Press Enter to search transcripts and notes across the vault.</div>}
                {hits?.map((h) => (
                  <button key={h.conv} className="v3-sres" onClick={() => openConv(h.conv)}>
                    <div className="st">{h.title}</div>
                    <div className="sp">{crumbText(h.conv) || "Vault"}</div>
                    <div className="snip">{h.snippet}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* TASKS */}
          {screen === "tasks" && (
            <div className="v3-col">
              <div className="v3-colin">
                <h1 className="page">Action items</h1>
                <div className="v3-psub">Pulled from every conversation. {openTasks.length} open across the vault.</div>
                {tasks.length === 0 && <div className="v3-empty">No action items yet. Summarize a conversation to pull them out.</div>}
                {sortedTasks.map((t) => (
                  <div key={t.conv + "|" + t.text} className={"v3-task " + (t.done ? "done" : "")}>
                    <button className={"v3-check " + (t.done ? "done" : "")} aria-label={t.done ? "Mark open" : "Mark done"} onClick={() => toggleTask(t)}>
                      {t.done && <Icon name="check" size={12} />}
                    </button>
                    <div style={{ flex: 1 }}>
                      <div className="tt">{t.text}</div>
                      <button className="schip link" onClick={() => openConv(t.conv)}>
                        <Icon name="file" size={13} /> {prettyName(t.conv.split("/").pop() || "")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ASK */}
          {screen === "ask" && (
            <div className="v3-col">
              <div className="v3-colin">
                <h1 className="page">Ask your memory</h1>
                <div className="v3-psub">
                  {mode !== "bunker"
                    ? "Answered from your vault with the AI set in Settings."
                    : aiIsLocal
                      ? "Answered from your vault on this Mac. Nothing leaves it."
                      : `Answered from your vault by your Ollama at ${aiHost}.`}
                </div>
                <div className="v3-bigsearch">
                  <Icon name="ask" size={19} />
                  <input
                    autoFocus
                    placeholder="What did we decide about the budget?"
                    value={askQ}
                    onChange={(e) => setAskQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runAsk(askQ)}
                  />
                  <button className="v3-iconbtn" onClick={() => runAsk(askQ)} disabled={asking || !askQ.trim()}>
                    Ask
                  </button>
                </div>
                {asking && <div className="v3-srxmeta">Thinking</div>}
                {ans && (
                  <div style={{ marginTop: 18 }}>
                    <p className="lead" style={{ whiteSpace: "pre-wrap" }}>
                      {ans.text}
                    </p>
                    {!ans.grounded && ans.citations.length > 0 && (
                      <div className="v3-note">Sources only. Turn on local AI in Settings for a written answer.</div>
                    )}
                    {ans.citations.length > 0 && <div className="v3-seclabel">Sources</div>}
                    {ans.citations.map((c) => (
                      <button key={c.n} className="v3-sres" onClick={() => openConv(c.conv)}>
                        <div className="st">
                          [{c.n}] {c.title}
                        </div>
                        <div className="sp">{crumbText(c.conv) || "Vault"}</div>
                        <div className="snip">{c.quote}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SETTINGS */}
          {screen === "settings" && (
            <div className="v3-col">
              <div className="v3-colin">
                <h1 className="page">Settings</h1>
                <div className="v3-psub">Files only and local first. Your vault is plain folders on disk.</div>

                <h2 className="v3-h2">Vault</h2>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Location</div>
                    <div className="mono path">{vpath || "Not set"}</div>
                  </div>
                  <button className="v3-iconbtn" onClick={() => vault.reveal().catch(fail)}>
                    Open
                  </button>
                  <button className="v3-iconbtn" onClick={changeVault}>
                    Change
                  </button>
                  {!usingDefaultVault && (
                    <button className="v3-iconbtn" title={defaultVault} onClick={resetVault}>
                      Use default
                    </button>
                  )}
                </div>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Import audio</div>
                    <div className="desc">Add a recording from a file. It is transcribed on this Mac.</div>
                  </div>
                  <button className="v3-iconbtn" onClick={importAudio} disabled={busy.import}>
                    {busy.import ? "Importing" : "Choose file"}
                  </button>
                </div>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Bring over earlier recordings</div>
                    <div className="desc">Copies recordings from the previous Memosa into this vault. The originals stay where they are.</div>
                    {notes.migrate && <div className="v3-note">{notes.migrate}</div>}
                  </div>
                  <button className="v3-iconbtn" onClick={runMigrate} disabled={busy.migrate}>
                    {busy.migrate ? "Importing" : "Import"}
                  </button>
                </div>

                <h2 className="v3-h2">Transcription</h2>
                <div className="v3-psub small">Whisper runs on this Mac. Download one model; Base is a good start.</div>
                {models.length === 0 && <div className="v3-hint">Loading models.</div>}
                {models.map((m) => (
                  <div key={m.name} className="v3-setrow">
                    <div className="info">
                      <div className="tt">{m.name[0].toUpperCase() + m.name.slice(1)}</div>
                      <div className="desc">{m.size_mb} MB</div>
                    </div>
                    {m.downloaded ? (
                      <span className="v3-ok">
                        <Icon name="check" size={14} /> Downloaded
                      </span>
                    ) : dl[m.name] !== undefined ? (
                      <span className="v3-progress">
                        <span style={{ width: `${Math.round((dl[m.name] || 0) * 100)}%` }} />
                      </span>
                    ) : (
                      <button
                        className="v3-iconbtn"
                        onClick={() => {
                          setDl((d) => ({ ...d, [m.name]: 0 }));
                          invoke("download_model", { model: m.name }).catch((e) => {
                            setDl((d) => {
                              const n = { ...d };
                              delete n[m.name];
                              return n;
                            });
                            fail(e);
                          });
                        }}
                      >
                        Download
                      </button>
                    )}
                  </div>
                ))}
                {models.length > 0 && !hasModel && <div className="v3-note">No model yet: recordings are saved, but not transcribed until you download one.</div>}

                <h2 className="v3-h2">Local AI</h2>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Use Ollama instead of Apple's model</div>
                    <div className="desc">
                      Summaries, Ask and suggestions use Apple's on-device model (Apple Intelligence). Turn this on to use your own Ollama models.
                      {localAI && aiStatus ? " " + aiStatus : ""}
                    </div>
                  </div>
                  <Switch
                    label="Use Ollama"
                    on={localAI}
                    onChange={(on) => saveSettings({ insight_engine: on ? "ollama" : "heuristic" })}
                  />
                </div>
                {settings && localAI && (
                  <div className="v3-setrow fields">
                    <label>
                      <span>Ollama address</span>
                      <input
                        defaultValue={settings.ollama_url}
                        onBlur={(e) => e.target.value.trim() !== settings.ollama_url && saveSettings({ ollama_url: e.target.value.trim() })}
                      />
                    </label>
                    <label>
                      <span>Model</span>
                      <input
                        defaultValue={settings.ollama_model}
                        onBlur={(e) => e.target.value.trim() !== settings.ollama_model && saveSettings({ ollama_model: e.target.value.trim() })}
                      />
                    </label>
                  </div>
                )}
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Search by meaning</div>
                    <div className="desc">
                      Local embeddings over transcripts and notes.
                      {indexInfo ? ` ${indexInfo.chunks} passages indexed, ${indexInfo.stale} conversations changed since.` : ""}
                    </div>
                    {notes.index && <div className="v3-note">{notes.index}</div>}
                  </div>
                  <button className="v3-iconbtn" onClick={runReindex} disabled={busy.index}>
                    {busy.index ? "Indexing" : "Build index"}
                  </button>
                </div>

                <h2 className="v3-h2">Connect another AI</h2>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">MCP server</div>
                    <div className="desc">Lets Claude, Cursor and other MCP clients read the vault. Read only.</div>
                  </div>
                  <Switch label="MCP server" on={!!settings?.mcp_server_enabled} onChange={(on) => saveSettings({ mcp_server_enabled: on })} />
                </div>
                {settings?.mcp_server_enabled && mcpConfig && (
                  <div className="v3-code">
                    <pre>{mcpConfig}</pre>
                    <button className="v3-iconbtn" onClick={() => copyText(mcpConfig, "MCP config copied.")}>
                      <Icon name="copy" size={15} /> Copy
                    </button>
                  </div>
                )}

                <h2 className="v3-h2">Calendar</h2>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Calendar access</div>
                    <div className="desc">
                      {calAccess === "granted"
                        ? "Allowed. Memosa reads the calendars on this Mac, including Google and Exchange accounts added to Calendar."
                        : calAccess === "denied" || calAccess === "restricted"
                          ? "Not allowed. Turn on Memosa under Privacy & Security, Calendars."
                          : calAccess === "add_only"
                            ? "Memosa can only add events. It needs full access to see meetings."
                            : "Memosa needs to see your calendar to offer to record meetings as they start."}
                    </div>
                  </div>
                  {calAccess === "granted" ? (
                    <span className="v3-ok">
                      <Icon name="check" size={14} /> Allowed
                    </span>
                  ) : calAccess === "not_asked" ? (
                    <button className="v3-iconbtn" onClick={askCalendar}>
                      Allow access
                    </button>
                  ) : (
                    <button
                      className="v3-iconbtn"
                      onClick={() =>
                        invoke("open_external_url", { url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars" }).catch(fail)
                      }
                    >
                      Open System Settings
                    </button>
                  )}
                </div>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Record meetings automatically</div>
                    <div className="desc">When a meeting starts, record it and file it in a matching folder with its attendees.</div>
                  </div>
                  <Switch
                    label="Record meetings automatically"
                    on={!!autoRec?.enabled}
                    onChange={(on) => {
                      if (on && calAccess === "not_asked") askCalendar();
                      saveAutoRec({ enabled: on });
                    }}
                  />
                </div>
                {autoRec?.enabled && (
                  <>
                    <div className="v3-setrow">
                      <div className="info">
                        <div className="tt">Ask before recording</div>
                        <div className="desc">A prompt a minute before the meeting; nothing is recorded unless you say yes.</div>
                      </div>
                      <Switch label="Ask before recording" on={autoRec.ask_first} onChange={(on) => saveAutoRec({ ask_first: on })} />
                    </div>
                    <div className="v3-setrow">
                      <div className="info">
                        <div className="tt">Only meetings with</div>
                        <div className="desc">Skips solo holds. All-day events are never recorded.</div>
                      </div>
                      <div className="v3-seg">
                        {[1, 2, 3].map((n) => (
                          <button key={n} className={autoRec.min_attendees === n ? "on" : ""} onClick={() => saveAutoRec({ min_attendees: n })}>
                            {n === 1 ? "Anyone" : `${n}+ people`}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="v3-setrow">
                      <div className="info">
                        <div className="tt">Video calls only</div>
                        <div className="desc">Zoom, Google Meet, Teams or Slack links.</div>
                      </div>
                      <Switch label="Video calls only" on={autoRec.video_only} onChange={(on) => saveAutoRec({ video_only: on })} />
                    </div>
                  </>
                )}
                {calAccess === "granted" && (
                  <div className="v3-upcoming">
                    <div className="v3-seclabel">Next 24 hours</div>
                    {upcoming.length === 0 && <div className="v3-hint">No meetings.</div>}
                    {upcoming.map((e) => (
                      <div key={e.id} className="v3-calrow">
                        <span className="when">{fmtTime(e.start)}</span>
                        <div className="what">
                          <div className="tt">{e.title}</div>
                          <div className="desc">
                            {e.attendees.length} {e.attendees.length === 1 ? "person" : "people"}
                            {e.platform ? `, ${e.platform}` : ""}, files to {e.folder.split("/").join(" / ")}
                          </div>
                        </div>
                        <span className={"v3-tag " + (autoRec?.enabled && e.matches ? "on" : "")}>
                          {autoRec?.enabled ? (e.matches ? (autoRec.ask_first ? "Will ask" : "Will record") : "Skipped") : "Off"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <h2 className="v3-h2">Appearance</h2>
                <div className="v3-seg">
                  {(["auto", "daylight", "vault"] as const).map((t) => (
                    <button key={t} className={t === themePref ? "on" : ""} onClick={() => setThemePref(t)}>
                      {t === "auto" ? "Auto" : t === "daylight" ? "Daylight" : "Vault"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* TOAST */}
      {toast && (
        <div className={"v3-toast " + toast.kind} role="status">
          <Icon name={toast.kind === "err" ? "alert" : "check"} size={16} />
          <span>{toast.text}</span>
          <button className="v3-ghost sm" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* COMMAND PALETTE */}
      {paletteOpen && (
        <div className="v3-scrim top" onClick={() => setPaletteOpen(false)}>
          <div className="v3-palette" onClick={(e) => e.stopPropagation()}>
            <div className="v3-palin">
              <Icon name="search" size={18} />
              <input
                autoFocus
                placeholder="Search, run an action, or ask"
                value={palQ}
                onChange={(e) => setPalQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && palQ.trim()) {
                    setPaletteOpen(false);
                    runAsk(palQ);
                  }
                }}
              />
            </div>
            <div className="v3-palbody">
              <div className="v3-palgroup">Actions</div>
              <button className="v3-palitem" onClick={palAction(() => startCapture())}>
                <Icon name="capture" size={16} /> Start recording <span className="pd">⌘R</span>
              </button>
              <button className="v3-palitem" onClick={palAction(importAudio)}>
                <Icon name="upload" size={16} /> Import audio
              </button>
              <button className="v3-palitem" onClick={palAction(addDomain)}>
                <Icon name="plus" size={16} /> New domain
              </button>
              <button className="v3-palitem" onClick={palAction(runReindex)}>
                <Icon name="search" size={16} /> Build search index
              </button>
              <button className="v3-palitem" onClick={palAction(() => setThemePref(theme === "daylight" ? "vault" : "daylight"))}>
                <Icon name="theme" size={16} /> Toggle theme
              </button>
              {palConvs.length > 0 && <div className="v3-palgroup">Conversations</div>}
              {palConvs.map((c) => (
                <button key={c.path} className="v3-palitem" onClick={palAction(() => openConv(c.path))}>
                  <Icon name="file" size={16} /> {prettyName(c.name)}
                </button>
              ))}
              {palQ.trim() && (
                <>
                  <div className="v3-palgroup">Ask your memory</div>
                  <button className="v3-palitem" onClick={palAction(() => runAsk(palQ))}>
                    <Icon name="ask" size={16} /> {"“"}
                    {palQ}
                    {"”"} <span className="pd">↵</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODE DIALOG */}
      {modeOpen && (
        <div className="v3-scrim center" onClick={() => setModeOpen(false)}>
          <div className="v3-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Privacy mode: {mode === "bunker" ? "Bunker" : "Cloud"}</h3>
            <p>
              <strong>Bunker</strong> keeps everything on this Mac. Cloud AI is refused; only models on this Mac run (Whisper for transcripts, Apple's on-device model or your Ollama for summaries).
            </p>
            <p>
              <strong>Cloud</strong> allows a paid AI provider with your own key. Audio still never leaves the Mac.
            </p>
            {mode === "bunker" && localAI && !aiIsLocal && (
              <p>Your Ollama address is another machine, so local AI is paused until you use an address on this Mac or switch to Cloud.</p>
            )}
            <div className="acts">
              {mode === "bunker" && (
                <button
                  className="v3-btn"
                  onClick={() => {
                    saveSettings({ app_mode: "cloud" });
                    setModeOpen(false);
                  }}
                >
                  Switch to Cloud
                </button>
              )}
              {mode === "cloud" && (
                <button
                  className="v3-btn primary"
                  onClick={() => {
                    saveSettings({ app_mode: "bunker" });
                    setModeOpen(false);
                  }}
                >
                  Switch to Bunker
                </button>
              )}
              <button className="v3-btn" onClick={() => setModeOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CALENDAR PROMPT (spec 07: ask first, never silent) */}
      {calPrompt && (
        <div className="v3-scrim center">
          <div className="v3-dialog">
            <h3>Record {"\u201c"}{calPrompt.event.title}{"\u201d"}?</h3>
            <p>
              Starts {fmtTime(calPrompt.event.start)}
              {calPrompt.event.attendees.length ? ` with ${calPrompt.event.attendees.slice(0, 3).join(", ")}` : ""}
              {calPrompt.event.attendees.length > 3 ? ` and ${calPrompt.event.attendees.length - 3} more` : ""}.
            </p>
            <label className="v3-field">
              <span>File in</span>
              <select value={calPrompt.folder} onChange={(e) => setCalPrompt({ ...calPrompt, folder: e.target.value })}>
                {[calPrompt.event.folder, ...allFolders.filter((f) => f !== calPrompt.event.folder)].map((f) => (
                  <option key={f} value={f}>
                    {f.split("/").join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="acts">
              <button className="v3-btn" onClick={() => setCalPrompt(null)}>
                Not this one
              </button>
              <button
                className="v3-btn primary"
                onClick={() => {
                  const { event, folder } = calPrompt;
                  setCalPrompt(null);
                  startCapture({ title: event.title, folder, people: event.attendees, eventId: event.id });
                }}
              >
                <Icon name="capture" size={15} /> Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOVE DIALOG */}
      {moveOpen && conv && (
        <div className="v3-scrim center" onClick={() => setMoveOpen(false)}>
          <div className="v3-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Move to folder</h3>
            <div className="v3-picklist">
              {allFolders.length === 0 && <p>No folders yet. Create a domain first.</p>}
              {allFolders.map((f) => (
                <button key={f} className="v3-mi" disabled={f === parentOf(conv.meta.id)} onClick={() => moveConv(f)}>
                  <Icon name="folder" size={16} /> {f.split("/").join(" / ")}
                </button>
              ))}
            </div>
            <div className="acts">
              <button className="v3-btn" onClick={() => setMoveOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM */}
      {confirmDelete && conv && (
        <div className="v3-scrim center" onClick={() => setConfirmDelete(false)}>
          <div className="v3-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Move to trash?</h3>
            <p>
              {"“"}
              {conv.meta.title}
              {"”"} moves to the vault trash folder (.memosa/trash). Nothing is erased.
            </p>
            <div className="acts">
              <button className="v3-btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button className="v3-btn primary danger" onClick={deleteConv}>
                Move to trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NAME PROMPT (in-app, since Tauri blocks window.prompt) */}
      {prompt && (
        <div className="v3-scrim center" onClick={() => setPrompt(null)}>
          <form
            className="v3-dialog"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const v = prompt.value.trim();
              if (!v) return;
              prompt.submit(v);
              setPrompt(null);
            }}
          >
            <h3>{prompt.title}</h3>
            <label className="v3-field">
              <span>{prompt.label}</span>
              <input autoFocus value={prompt.value} onChange={(e) => setPrompt({ ...prompt, value: e.target.value })} />
            </label>
            <div className="acts">
              <button type="button" className="v3-btn" onClick={() => setPrompt(null)}>
                Cancel
              </button>
              <button type="submit" className="v3-btn primary" disabled={!prompt.value.trim()}>
                {prompt.submitLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
