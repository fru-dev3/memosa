// Memosa 3.0 UI (spec 11), wired to the files-only vault + the existing recorder.
// Coexists with the legacy app; mounted via ?ui=3.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import "./v3.css";

type Screen = "library" | "search" | "tasks" | "ask" | "settings";
type Tab = "summary" | "transcript" | "speakers" | "actions";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const fmtClock = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const prettyName = (n: string) => n.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ");

function flattenConvs(node: TreeNode | null, out: TreeNode[] = []): TreeNode[] {
  if (!node) return out;
  if (node.kind === "conversation") out.push(node);
  node.children?.forEach((c) => flattenConvs(c, out));
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
        {isConv ? prettyName(node.name) : node.name}
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

export default function App3() {
  const [theme, setTheme] = useState<"daylight" | "vault">("daylight");
  const [screen, setScreen] = useState<Screen>("library");
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [folder, setFolder] = useState("");
  const [list, setList] = useState<ConvMeta[]>([]);
  const [conv, setConv] = useState<ConvBundle | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchMode, setSearchMode] = useState<"semantic" | "exact">("exact");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [askQ, setAskQ] = useState("");
  const [ans, setAns] = useState<AskAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [vpath, setVpath] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migReport, setMigReport] = useState<string | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [indexNote, setIndexNote] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [recTitle, setRecTitle] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palQ, setPalQ] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [promptCfg, setPromptCfg] = useState<{ title: string; submit: (v: string) => void } | null>(null);
  const [promptVal, setPromptVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const recTimer = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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

  const reloadTree = useCallback(() => {
    vault
      .tree()
      .then((t) => {
        setTree(t);
        loadList(t, folder);
      })
      .catch((e) => setErr(String(e)));
  }, [loadList, folder]);

  useEffect(() => {
    vault.tree().then((t) => {
      setTree(t);
      loadList(t, "");
    }).catch((e) => setErr(String(e)));
    vault.tasks("all").then(setTasks).catch(() => {});
    vault.path().then(setVpath).catch(() => {});
  }, [loadList]);

  const openFolder = useCallback(
    (path: string) => {
      setFolder(path);
      setScreen("library");
      loadList(tree, path);
    },
    [tree, loadList],
  );

  const openConv = useCallback((id: string) => {
    const parent = id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "";
    setFolder(parent);
    setScreen("library");
    setTab("summary");
    setTranscript(null);
    setExportOpen(false);
    vault.get(id).then(setConv).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if ((tab === "transcript" || tab === "speakers") && conv && !transcript) {
      vault.transcript(conv.meta.id).then(setTranscript).catch(() => {});
    }
  }, [tab, conv, transcript]);

  const runSearch = useCallback(() => {
    if (!query.trim()) return setHits([]);
    vault.search(query, searchMode).then(setHits).catch((e) => setErr(String(e)));
  }, [query, searchMode]);

  const runAsk = useCallback(() => {
    if (!askQ.trim()) return;
    setAsking(true);
    setAns(null);
    vault.ask(askQ).then(setAns).catch((e) => setErr(String(e))).finally(() => setAsking(false));
  }, [askQ]);

  const toggleTask = useCallback(
    (t: Task) => {
      vault.toggleTask(t.conv, t.text, !t.done).then(() => {
        setTasks((ts) => ts.map((x) => (x === t ? { ...x, done: !x.done } : x)));
        if (conv && conv.meta.id === t.conv)
          setConv({
            ...conv,
            notes: { ...conv.notes, actions: conv.notes.actions.map((a) => (a.text === t.text ? { ...a, done: !a.done } : a)) },
          });
      });
    },
    [conv],
  );

  const addDomain = useCallback(() => {
    setPromptVal("");
    setPromptCfg({
      title: "New domain",
      submit: (name) => vault.createFolder(name).then(reloadTree).catch((e) => setErr(String(e))),
    });
  }, [reloadTree]);

  const addSubfolder = useCallback(
    (parent: string) => {
      setPromptVal("");
      setPromptCfg({
        title: `New folder in ${parent}`,
        submit: (name) => vault.createFolder(`${parent}/${name}`).then(reloadTree).catch((e) => setErr(String(e))),
      });
    },
    [reloadTree],
  );

  const startCapture = useCallback(() => {
    const title = `Recording ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
    setRecTitle(title);
    recorder
      .start(title)
      .then(() => {
        setRecording(true);
        setRecSec(0);
        recTimer.current = window.setInterval(() => setRecSec((s) => s + 1), 1000);
      })
      .catch((e) => setErr("Couldn't start recording: " + String(e)));
  }, []);

  const stopCapture = useCallback(() => {
    if (recTimer.current) window.clearInterval(recTimer.current);
    recorder
      .stop()
      .then(() => {
        setRecording(false);
        // the recorder mirrors into the vault on finalize; refresh shortly after
        window.setTimeout(reloadTree, 2500);
      })
      .catch((e) => {
        setRecording(false);
        setErr("Couldn't stop recording: " + String(e));
      });
  }, [reloadTree]);

  const runMigrate = useCallback(() => {
    setMigrating(true);
    setMigReport(null);
    vault
      .migrate()
      .then((r) => {
        setMigReport(`Imported ${r.conversations} conversations (${r.audio_copied} with audio, ${r.skipped} already present).`);
        reloadTree();
      })
      .catch((e) => setMigReport("Migration failed: " + String(e)))
      .finally(() => setMigrating(false));
  }, [reloadTree]);

  const runReindex = useCallback(() => {
    setReindexing(true);
    setIndexNote(null);
    vault
      .reindex()
      .then((n) => setIndexNote(`Indexed ${n} chunks for semantic search.`))
      .catch((e) => setIndexNote("Indexing needs a local embedding model (Ollama). " + String(e)))
      .finally(() => setReindexing(false));
  }, []);

  const summarizeConv = useCallback(() => {
    if (!conv) return;
    setSummarizing(true);
    vault.summarize(conv.meta.id).then(() => vault.get(conv.meta.id).then(setConv)).catch((e) => setErr(String(e))).finally(() => setSummarizing(false));
  }, [conv]);

  const changeVault = useCallback(async () => {
    try {
      const picked = await invoke<string | null>("pick_storage_folder");
      if (picked) {
        await vault.setPath(picked);
        setVpath(picked);
        reloadTree();
      }
    } catch (e) {
      setErr(String(e));
    }
  }, [reloadTree]);

  // keyboard: ⌘K palette, ⌘R record, Esc close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        if (!recording) startCapture();
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
        setExportOpen(false);
        setModeOpen(false);
        setPromptCfg(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [recording, startCapture]);

  const allConvs = useMemo(() => flattenConvs(tree), [tree]);
  const palConvs = useMemo(
    () => allConvs.filter((c) => prettyName(c.name).toLowerCase().includes(palQ.toLowerCase())).slice(0, 6),
    [allConvs, palQ],
  );
  const openTasks = tasks.filter((t) => !t.done);
  const crumb = useMemo(() => folder.split("/").filter(Boolean), [folder]);
  const isEmpty = !!tree && (tree.children?.length ?? 0) === 0;
  const speakers = transcript ? Object.values(transcript.speakers) : [];

  const wave = useMemo(() => Array.from({ length: 64 }, (_, i) => i), []);

  return (
    <div className="v3">
      {/* titlebar */}
      <div className="v3-bar" data-tauri-drag-region>
        <div className="v3-wordmark">
          <span className="v3-logo">
            <Icon name="logo" size={13} />
          </span>
          Memosa
        </div>
        <div className="v3-omni" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={15} />
          Search or ask your conversations…
          <span className="kbd">⌘K</span>
        </div>
        <div className="v3-right">
          <div className="v3-mode" onClick={() => setModeOpen(true)}>
            <span className="dot" /> Bunker
          </div>
          <div className="v3-ghost" title="Daylight / Vault" onClick={() => setTheme((t) => (t === "daylight" ? "vault" : "daylight"))}>
            <Icon name="theme" size={17} />
          </div>
        </div>
      </div>

      <div className="v3-body">
        {/* rail */}
        <div className="v3-rail">
          {(["library", "ask", "search", "tasks"] as Screen[]).map((s) => (
            <div key={s} className={"v3-nav " + (screen === s ? "active" : "")} onClick={() => setScreen(s)}>
              <Icon name={s} size={16} />
              {s[0].toUpperCase() + s.slice(1)}
              {s === "tasks" && openTasks.length > 0 && <span className="badge">{openTasks.length}</span>}
            </div>
          ))}

          <div className="v3-ghdr-row">
            <span>Domains</span>
            <span className="v3-add" title="New domain" onClick={addDomain}>
              <Icon name="plus" size={14} />
            </span>
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
          {isEmpty && <div className="v3-empty" style={{ padding: "14px 10px" }}>No domains yet. Click + to add one.</div>}

          <div className="v3-spacer" />
          <div className="v3-capture" onClick={() => (recording ? stopCapture() : startCapture())}>
            <Icon name={recording ? "stop" : "capture"} size={16} />
            {recording ? "Stop recording" : "Capture"}
            <span className="kbd">⌘R</span>
          </div>
          <div className={"v3-nav " + (screen === "settings" ? "active" : "")} onClick={() => setScreen("settings")}>
            <Icon name="settings" size={16} /> Settings
          </div>
        </div>

        {/* stage */}
        <div className={"v3-stage " + (screen === "library" && !isEmpty ? "v3-library" : "")}>
          {err && <div className="v3-empty">⚠ {err}</div>}

          {/* EMPTY / FIRST RUN */}
          {isEmpty && screen === "library" && (
            <div className="v3-hero">
              <div className="v3-heroin">
                <div className="v3-bigmark">
                  <Icon name="logo" size={32} />
                </div>
                <h1>Your memory starts here.</h1>
                <div className="sub">Record a conversation, or import your existing recordings — Memosa files them as plain text on your Mac.</div>
                <div className="v3-herocta">
                  <div className="v3-btnbig primary" onClick={startCapture}>
                    <Icon name="capture" size={18} /> Start recording
                  </div>
                  <div className="v3-btnbig ghost" onClick={runMigrate}>
                    <Icon name="download" size={18} /> {migrating ? "Importing…" : "Import existing"}
                  </div>
                </div>
                {migReport && <div className="v3-srxmeta" style={{ marginTop: 18, color: "var(--accent)" }}>{migReport}</div>}
              </div>
            </div>
          )}

          {/* LIBRARY */}
          {screen === "library" && !isEmpty && (
            <>
              <div className="v3-list">
                <div className="v3-crumb">
                  {crumb.length === 0 ? <b>All conversations</b> : crumb.map((c, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <Icon name="chevron" size={13} />}
                      {i === crumb.length - 1 ? <b>{c}</b> : <span>{c}</span>}
                    </React.Fragment>
                  ))}
                </div>
                <div className="v3-listsub">{list.length} CONVERSATIONS</div>
                {list.length === 0 && <div className="v3-empty">No conversations here yet.</div>}
                {list.map((m) => (
                  <div key={m.id} className={"v3-row " + (conv?.meta.id === m.id ? "sel" : "")} onClick={() => openConv(m.id)}>
                    <div>
                      <div className="title">{m.title}</div>
                      <div className="meta">
                        {m.duration_sec > 0 ? `${Math.round(m.duration_sec / 60)}m` : "—"}
                        {m.people.length > 0 ? ` · ${m.people.slice(0, 2).join(", ")}` : ""}
                      </div>
                    </div>
                    <span className="time">{fmtDate(m.created)}</span>
                  </div>
                ))}
              </div>

              <div className="v3-detail" style={{ position: "relative" }}>
                {!conv ? (
                  <div className="v3-empty" style={{ marginTop: 80 }}>Select a conversation, or hit Capture to record one.</div>
                ) : (
                  <div className="v3-dinner">
                    <div className="v3-dtop">
                      <span className="v3-kicker">
                        {fmtDate(conv.meta.created).toUpperCase()} · {conv.meta.duration_sec > 0 ? `${Math.round(conv.meta.duration_sec / 60)} MIN` : "—"}
                      </span>
                      <div className="v3-actions">
                        <div className="v3-iconbtn" onClick={summarizeConv}>
                          <Icon name="ask" size={15} /> {summarizing ? "Summarizing…" : "Summarize"}
                        </div>
                        <div className="v3-iconbtn" onClick={() => setExportOpen((o) => !o)}>
                          <Icon name="download" size={15} /> Export
                        </div>
                        <div className="v3-iconbtn" title="Reveal in Finder" onClick={() => vault.reveal(conv.meta.id)}>
                          <Icon name="reveal" size={15} />
                        </div>
                      </div>
                    </div>
                    {exportOpen && (
                      <div className="v3-menu" onMouseLeave={() => setExportOpen(false)}>
                        <div className="v3-mi" onClick={() => { vault.exportMarkdown(conv.meta.id).then((md) => navigator.clipboard.writeText(md)); setExportOpen(false); }}>
                          <Icon name="copy" size={16} /> Copy as Markdown
                        </div>
                        <div className="v3-mi" onClick={() => { vault.reveal(conv.meta.id); setExportOpen(false); }}>
                          <Icon name="reveal" size={16} /> Reveal files in Finder
                        </div>
                      </div>
                    )}
                    <h1 className="det">{conv.meta.title}</h1>
                    <div className="v3-foldertag">
                      <Icon name="folder" size={14} /> {conv.meta.id.split("/").slice(0, -1).join(" › ")}
                      {conv.meta.tags.length > 0 ? "  ·  " + conv.meta.tags.map((t) => "#" + t).join(" ") : ""}
                    </div>
                    <div className="v3-tabs">
                      {(["summary", "transcript", "speakers", "actions"] as Tab[]).map((t) => (
                        <div key={t} className={"v3-tab " + (tab === t ? "active" : "")} onClick={() => setTab(t)}>
                          {t === "actions" ? "Action items" : t[0].toUpperCase() + t.slice(1)}
                        </div>
                      ))}
                    </div>

                    {tab === "summary" && (
                      <>
                        {conv.notes.summary ? <p className="lead">{conv.notes.summary}</p> : <p style={{ color: "var(--muted)" }}>No summary yet — hit Summarize (needs a local model).</p>}
                        {conv.notes.decisions.length > 0 && (
                          <>
                            <div className="v3-seclabel">Decisions</div>
                            {conv.notes.decisions.map((d, i) => <p key={i}>{d}</p>)}
                          </>
                        )}
                      </>
                    )}

                    {tab === "actions" && (
                      conv.notes.actions.length === 0 ? <p style={{ color: "var(--muted)" }}>No action items.</p> :
                      conv.notes.actions.map((a, i) => (
                        <div key={i} className={"v3-ai " + (a.done ? "done" : "")} onClick={() => toggleTask({ ...a, conv: conv.meta.id })}>
                          <span className={"v3-check " + (a.done ? "done" : "")}>{a.done && <Icon name="caret" size={11} />}</span>
                          <div>
                            <div className="txt">{a.text}</div>
                            {(a.owner || a.due) && <div className="v3-owner">{[a.owner, a.due].filter(Boolean).join(" · ")}</div>}
                          </div>
                        </div>
                      ))
                    )}

                    {tab === "transcript" && (
                      !transcript || transcript.segments.length === 0 ? <p style={{ color: "var(--muted)" }}>No transcript available.</p> :
                      transcript.segments.map((s, i) => (
                        <div key={i} className="v3-utt">
                          <div className="ts">{fmtClock(s.start)}</div>
                          <div>
                            {transcript.speakers[s.speaker] && <span className="sp">{transcript.speakers[s.speaker]}</span>}
                            <div className="txt2">{s.text}</div>
                          </div>
                        </div>
                      ))
                    )}

                    {tab === "speakers" && (
                      speakers.length === 0 ? <p style={{ color: "var(--muted)" }}>No speaker labels for this conversation.</p> :
                      <>
                        <div className="v3-seclabel">Speakers</div>
                        {speakers.map((s, i) => (
                          <div key={i} className="v3-ai">
                            <span className="ico" style={{ color: "var(--accent)" }}><Icon name="speaker" size={16} /></span>
                            <div className="txt">{s}</div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* SEARCH */}
          {screen === "search" && (
            <div className="v3-col">
              <div className="v3-colin">
                <div className="v3-bigsearch">
                  <Icon name="search" size={19} />
                  <input autoFocus placeholder="Search your conversations…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
                  <div className="v3-modetoggle">
                    <button className={searchMode === "semantic" ? "on" : ""} onClick={() => { setSearchMode("semantic"); }}>Meaning</button>
                    <button className={searchMode === "exact" ? "on" : ""} onClick={() => { setSearchMode("exact"); }}>Exact</button>
                  </div>
                </div>
                <div className="v3-srxmeta">{searchMode === "semantic" ? "RANKED BY MEANING" : "EXACT MATCH"} · {hits.length} RESULTS</div>
                {hits.map((h) => (
                  <div key={h.conv} className="v3-sres" onClick={() => openConv(h.conv)}>
                    <div className="st">{h.title}</div>
                    <div className="sp">{h.conv.split("/").slice(0, -1).join(" › ")}</div>
                    <div className="snip">{h.snippet}</div>
                  </div>
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
                {tasks.length === 0 && <div className="v3-empty">No action items yet.</div>}
                {tasks.map((t, i) => (
                  <div key={i} className={"v3-task " + (t.done ? "done" : "")}>
                    <span className={"v3-check " + (t.done ? "done" : "")} onClick={() => toggleTask(t)}>{t.done && <Icon name="caret" size={11} />}</span>
                    <div style={{ flex: 1 }}>
                      <div className="tt">{t.text}</div>
                      <div className="schip" onClick={() => openConv(t.conv)} style={{ cursor: "pointer" }}>
                        <Icon name="file" size={12} /> {prettyName(t.conv.split("/").pop() || "")}
                      </div>
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
                <div className="v3-psub">Answered locally from your vault — nothing leaves your Mac.</div>
                <div className="v3-bigsearch">
                  <Icon name="ask" size={19} />
                  <input autoFocus placeholder="What did we decide about…?" value={askQ} onChange={(e) => setAskQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runAsk()} />
                </div>
                {asking && <div className="v3-srxmeta">THINKING…</div>}
                {ans && (
                  <div style={{ marginTop: 18 }}>
                    <p className="lead" style={{ whiteSpace: "pre-wrap" }}>{ans.text}</p>
                    {!ans.grounded && <div className="v3-srxmeta" style={{ color: "var(--live)" }}>RETRIEVAL ONLY — START A LOCAL MODEL FOR A WRITTEN ANSWER</div>}
                    {ans.citations.length > 0 && <div className="v3-seclabel">Sources</div>}
                    {ans.citations.map((c) => (
                      <div key={c.n} className="v3-sres" onClick={() => openConv(c.conv)}>
                        <div className="st">[{c.n}] {c.title}</div>
                        <div className="sp">{c.conv.split("/").slice(0, -1).join(" › ")}</div>
                        <div className="snip">{c.quote}</div>
                      </div>
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
                <div className="v3-psub">Files-only and local-first. Your vault is plain folders on disk.</div>

                <div className="v3-seclabel">Vault location</div>
                <div className="v3-task" style={{ alignItems: "center" }}>
                  <div className="mono" style={{ flex: 1, fontSize: 12, color: "var(--text)" }}>{vpath || "—"}</div>
                  <div className="v3-iconbtn" onClick={() => vault.reveal()}>Open</div>
                  <div className="v3-iconbtn" onClick={changeVault}>Change…</div>
                </div>

                <div className="v3-seclabel">Your data</div>
                <div className="v3-task" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div className="tt">Import existing recordings</div>
                    <div className="schip">One-time migration from the legacy app into this vault.</div>
                  </div>
                  <div className="v3-iconbtn" onClick={runMigrate}>{migrating ? "Importing…" : "Run migration"}</div>
                </div>
                {migReport && <div className="v3-srxmeta" style={{ color: "var(--accent)" }}>{migReport}</div>}

                <div className="v3-seclabel">Models</div>
                <div className="v3-task">
                  <div>
                    <div className="tt">Local &amp; open-source only</div>
                    <div className="schip">whisper.cpp · Ollama · local embeddings — no paid providers.</div>
                  </div>
                </div>

                <div className="v3-seclabel">Search index</div>
                <div className="v3-task" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div className="tt">Semantic search index</div>
                    <div className="schip">Local embeddings over transcripts — powers Ask &amp; Search by meaning.</div>
                  </div>
                  <div className="v3-iconbtn" onClick={runReindex}>{reindexing ? "Indexing…" : "Build index"}</div>
                </div>
                {indexNote && <div className="v3-srxmeta" style={{ color: "var(--accent)" }}>{indexNote}</div>}

                <div className="v3-seclabel">Backup · Google Drive</div>
                <div className="v3-task" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1 }}>
                    <div className="tt">Sync text to Drive</div>
                    <div className="schip">Transcripts &amp; notes only — audio never leaves your Mac.</div>
                  </div>
                  <div className="v3-iconbtn" onClick={() => vault.syncNow().catch((e) => setErr(String(e)))}>Sync now</div>
                </div>

                <div className="v3-seclabel">Theme</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["daylight", "vault"] as const).map((t) => (
                    <div key={t} className="v3-iconbtn" style={t === theme ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}} onClick={() => setTheme(t)}>
                      {t === "daylight" ? "Daylight" : "Vault"}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* COMMAND PALETTE */}
      {paletteOpen && (
        <div className="v3-scrim top" onClick={() => setPaletteOpen(false)}>
          <div className="v3-palette" onClick={(e) => e.stopPropagation()}>
            <div className="v3-palin">
              <Icon name="search" size={18} />
              <input autoFocus placeholder="Search, run an action, or ask…" value={palQ} onChange={(e) => setPalQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && palQ.trim()) { setPaletteOpen(false); setScreen("ask"); setAskQ(palQ); setTimeout(runAsk, 0); } }} />
            </div>
            <div className="v3-palbody">
              <div className="v3-palgroup">Actions</div>
              <div className="v3-palitem" onClick={() => { setPaletteOpen(false); startCapture(); }}>
                <Icon name="capture" size={16} /> Start recording <span className="pd">⌘R</span>
              </div>
              <div className="v3-palitem" onClick={() => { setPaletteOpen(false); addDomain(); }}>
                <Icon name="plus" size={16} /> New domain
              </div>
              <div className="v3-palitem" onClick={() => { setPaletteOpen(false); runReindex(); }}>
                <Icon name="search" size={16} /> Build search index
              </div>
              <div className="v3-palitem" onClick={() => { setTheme((t) => (t === "daylight" ? "vault" : "daylight")); }}>
                <Icon name="theme" size={16} /> Toggle theme
              </div>
              {palConvs.length > 0 && <div className="v3-palgroup">Conversations</div>}
              {palConvs.map((c) => (
                <div key={c.path} className="v3-palitem" onClick={() => { setPaletteOpen(false); openConv(c.path); }}>
                  <Icon name="file" size={16} /> {prettyName(c.name)}
                </div>
              ))}
              {palQ.trim() && (
                <>
                  <div className="v3-palgroup">Ask the corpus</div>
                  <div className="v3-palitem" onClick={() => { setPaletteOpen(false); setScreen("ask"); setAskQ(palQ); setTimeout(runAsk, 0); }}>
                    <Icon name="ask" size={16} /> “{palQ}” <span className="pd">↵</span>
                  </div>
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
              <span className="v3-reclabel">REC</span>
              <span className="v3-rectime">{fmtClock(recSec)}</span>
              <span className="v3-rectitle">{recTitle}</span>
            </div>
            <div className="v3-wave">
              {wave.map((i) => (
                <i key={i} style={{ animationDelay: `${i * 0.04}s`, animationDuration: `${0.6 + (i % 7) * 0.12}s` }} />
              ))}
            </div>
            <div className="v3-capfoot">
              <button className="v3-btn primary" onClick={stopCapture}>
                <Icon name="stop" size={15} /> Stop &amp; save
              </button>
              <span style={{ marginLeft: "auto" }} className="v3-srxmeta">Saved to your vault when you stop</span>
            </div>
          </div>
        </div>
      )}

      {/* MODE DIALOG */}
      {modeOpen && (
        <div className="v3-scrim center" onClick={() => setModeOpen(false)}>
          <div className="v3-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Privacy mode</h3>
            <p><strong style={{ color: "var(--text)" }}>Bunker (active):</strong> everything stays on this Mac. Cloud AI is refused; only local models (whisper, Ollama) run. Your audio never leaves the device.</p>
            <p><strong style={{ color: "var(--text)" }}>Cloud:</strong> would let you use a paid provider with your own key for summaries &amp; chat — set one up in Settings to enable it. Audio still never leaves.</p>
            <div className="acts">
              <button className="v3-btn" onClick={() => setModeOpen(false)}>Stay in Bunker</button>
            </div>
          </div>
        </div>
      )}

      {/* NAME PROMPT (in-app, since Tauri blocks window.prompt) */}
      {promptCfg && (
        <div className="v3-scrim center" onClick={() => setPromptCfg(null)}>
          <div className="v3-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{promptCfg.title}</h3>
            <input
              autoFocus
              value={promptVal}
              placeholder="Name…"
              onChange={(e) => setPromptVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && promptVal.trim()) {
                  promptCfg.submit(promptVal.trim());
                  setPromptCfg(null);
                }
              }}
              style={{
                width: "100%",
                height: 38,
                padding: "0 12px",
                margin: "6px 0 4px",
                border: "1px solid var(--hairline-strong)",
                borderRadius: 8,
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
            <div className="acts">
              <button className="v3-btn" onClick={() => setPromptCfg(null)}>Cancel</button>
              <button
                className="v3-btn primary"
                onClick={() => {
                  if (promptVal.trim()) {
                    promptCfg.submit(promptVal.trim());
                    setPromptCfg(null);
                  }
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
