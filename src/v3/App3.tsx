// Memosa 3.0 UI (spec 11), wired to the files-only vault and the existing recorder.
// The legacy app stays reachable with ?ui=legacy (see main.tsx).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Icon } from "./icons";
import {
  recorder,
  vault,
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
type Prompt = { title: string; label: string; value: string; submitLabel: string; submit: (v: string) => void } | null;

const THEME_KEY = "memosa.theme";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fmtClock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const fmtMins = (sec: number) => (sec <= 0 ? "No length yet" : sec < 60 ? "under 1 min" : `${Math.round(sec / 60)} min`);
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
  const [recTitle, setRecTitle] = useState("");
  const [levels, setLevels] = useState<number[]>(() => Array(48).fill(0));
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
  const recTimer = useRef<number | null>(null);
  const folderRef = useRef("");
  const convIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

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
    if (convIdRef.current) {
      const id = convIdRef.current;
      loadConv(id);
      vault.transcript(id).then((t) => convIdRef.current === id && setTranscript(t)).catch(() => {});
    }
  }, [loadList, loadConv, fail]);

  useEffect(() => {
    reloadAll();
    vault.path().then(setVpath).catch(() => {});
    // Files can change outside the app (Finder, another AI, a sync): refresh on focus.
    const onFocus = () => reloadAll();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reloadAll]);

  const loadSettingsScreen = useCallback(() => {
    invoke<AppSettings>("get_settings").then(setSettings).catch(fail);
    invoke<ModelInfo[]>("get_available_models").then(setModels).catch(() => {});
    invoke<{ available: boolean; detail: string }>("get_insight_engine_status").then((s) => setAiStatus(s.detail)).catch(() => {});
    vault.mcpInfo().then((i) => setMcpConfig(i.config)).catch(() => {});
    vault.embeddingStatus().then(setIndexInfo).catch(() => {});
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
      folderRef.current = path;
      setFolder(path);
      setScreen("library");
      loadList(tree, path);
    },
    [tree, loadList],
  );

  const openConv = useCallback(
    (id: string) => {
      const parent = parentOf(id);
      folderRef.current = parent;
      setFolder(parent);
      setScreen("library");
      setTab("summary");
      setTranscript(null);
      setMenu(null);
      loadList(tree, parent);
      loadConv(id);
    },
    [tree, loadList, loadConv],
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
  const pollAfterCapture = useCallback(() => {
    // Whisper runs in the background after a recording or import; keep re-reading
    // the vault for a few minutes so the transcript and notes appear on their own.
    if (pollRef.current) window.clearInterval(pollRef.current);
    let n = 0;
    pollRef.current = window.setInterval(() => {
      reloadAll();
      if (++n >= 45 && pollRef.current) window.clearInterval(pollRef.current);
    }, 4000);
  }, [reloadAll]);
  useEffect(() => () => void (pollRef.current && window.clearInterval(pollRef.current)), []);

  useEffect(() => {
    if (!recording) return;
    const un = recorder.onLevel((level) =>
      setLevels((ls) => [...ls.slice(1), Math.max(0, Math.min(1, Number(level) || 0))]),
    );
    return () => void un.then((f) => f());
  }, [recording]);

  const startCapture = useCallback(() => {
    if (recording) return;
    const title = `Recording ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    setRecTitle(title);
    setLevels(Array(48).fill(0));
    recorder
      .start(title)
      .then(() => {
        setRecording(true);
        setRecSec(0);
        recTimer.current = window.setInterval(() => setRecSec((s) => s + 1), 1000);
      })
      .catch((e) => flash("err", "Couldn't start recording: " + String(e)));
  }, [recording, flash]);

  const stopCapture = useCallback(() => {
    if (recTimer.current) window.clearInterval(recTimer.current);
    recorder
      .stop()
      .then(() => {
        setRecording(false);
        flash("ok", "Saved to Recordings. Transcribing on this Mac.");
        window.setTimeout(reloadAll, 1500);
        pollAfterCapture();
      })
      .catch((e) => {
        setRecording(false);
        flash("err", "Couldn't stop recording: " + String(e));
      });
  }, [reloadAll, pollAfterCapture, flash]);

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
  const aiIsLocal = !localAI || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(aiHost);

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

          <div className="v3-spacer" />
          <button className={"v3-capture " + (recording ? "rec" : "")} onClick={() => (recording ? stopCapture() : startCapture())}>
            <Icon name={recording ? "stop" : "capture"} size={16} />
            {recording ? "Stop recording" : "Capture"}
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
                  <button className="v3-btnbig primary" onClick={startCapture}>
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
                <div className="v3-listhead">
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
                <div className="v3-listsub">
                  {list.length} {list.length === 1 ? "conversation" : "conversations"}
                </div>
                {list.length === 0 && <div className="v3-empty">No conversations here yet.</div>}
                {list.map((m) => (
                  <button key={m.id} className={"v3-row " + (conv?.meta.id === m.id ? "sel" : "")} onClick={() => openConv(m.id)}>
                    <div>
                      <div className="title">{m.title}</div>
                      <div className="meta">
                        {fmtMins(m.duration_sec)}
                        {m.people.length > 0 ? `, ${m.people.slice(0, 2).join(", ")}` : ""}
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
                      {conv.meta.tags.length > 0 ? ", " + conv.meta.tags.map((t) => "#" + t).join(" ") : ""}
                    </div>
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
                            No summary yet. Press Summarize to write one with local AI{localAI ? "" : " (turn it on in Settings first)"}.
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
                          <div key={i} className="v3-utt">
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
                    <div className="tt">Summaries and Ask with Ollama</div>
                    <div className="desc">Open-source models on your own machine.{localAI && aiStatus ? " " + aiStatus : " Off."}</div>
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

                <h2 className="v3-h2">Backup</h2>
                <div className="v3-setrow">
                  <div className="info">
                    <div className="tt">Sync text to Google Drive</div>
                    <div className="desc">Transcripts and notes only; audio never leaves your Mac. Drive sign-in is not built yet, so Sync now lists what would upload.</div>
                    {notes.sync && <div className="v3-note">{notes.sync}</div>}
                  </div>
                  <button className="v3-iconbtn" onClick={syncNow} disabled={busy.sync}>
                    {busy.sync ? "Syncing" : "Sync now"}
                  </button>
                </div>

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
              <button className="v3-palitem" onClick={palAction(startCapture)}>
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

      {/* CAPTURE OVERLAY */}
      {recording && (
        <div className="v3-scrim bottom">
          <div className="v3-capwrap">
            <div className="v3-caphead">
              <span className="v3-recdot" />
              <span className="v3-reclabel">Recording</span>
              <span className="v3-rectime">{fmtClock(recSec)}</span>
              <span className="v3-rectitle">{recTitle}</span>
            </div>
            <div className="v3-wave">
              {levels.map((l, i) => (
                <i key={i} style={{ height: `${Math.max(6, Math.min(100, Math.sqrt(l) * 160))}%` }} />
              ))}
            </div>
            <div className="v3-capfoot">
              <button className="v3-btn primary" onClick={stopCapture}>
                <Icon name="stop" size={15} /> Stop and save
              </button>
              <span style={{ marginLeft: "auto" }} className="v3-srxmeta">
                Saved to your vault when you stop
              </span>
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
              <strong>Bunker</strong> keeps everything on this Mac. Cloud AI is refused; only local models (Whisper, Ollama) run.
            </p>
            <p>
              <strong>Cloud</strong> allows a paid AI provider with your own key. Audio still never leaves the Mac.
            </p>
            <div className="acts">
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
