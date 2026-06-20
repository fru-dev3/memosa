// Memosa 3.0 UI shell (spec 11), wired to the files-only vault. Coexists with the
// legacy app; mounted via `?ui=3`.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import {
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

type Screen = "library" | "search" | "tasks" | "ask";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ---- recursive folder tree ----
function Tree({
  node,
  depth,
  onOpenFolder,
  onOpenConv,
  selectedConv,
}: {
  node: TreeNode;
  depth: number;
  onOpenFolder: (path: string) => void;
  onOpenConv: (id: string) => void;
  selectedConv: string | null;
}) {
  const [collapsed, setCollapsed] = useState(depth >= 2);
  const isConv = node.kind === "conversation";
  const hasKids = (node.children?.length ?? 0) > 0;

  return (
    <div>
      <div
        className={
          "v3-twig " +
          (isConv ? "file " : "folder ") +
          (selectedConv === node.path ? "on" : "")
        }
        onClick={() => (isConv ? onOpenConv(node.path) : onOpenFolder(node.path))}
      >
        {isConv ? (
          <span className="v3-gap" />
        ) : hasKids ? (
          <span
            className={"v3-caret " + (collapsed ? "col" : "")}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
          >
            <Icon name="caret" size={13} />
          </span>
        ) : (
          <span className="v3-gap" />
        )}
        <span className="ico">
          <Icon name={isConv ? "file" : depth === 0 ? "domain" : "folder"} size={isConv ? 13 : 15} />
        </span>
        {isConv ? node.name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ") : node.name}
        {typeof node.count === "number" && !isConv && <span className="ct">{node.count}</span>}
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
              selectedConv={selectedConv}
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
  const [folder, setFolder] = useState<string>("");
  const [list, setList] = useState<ConvMeta[]>([]);
  const [conv, setConv] = useState<ConvBundle | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [tab, setTab] = useState<"summary" | "transcript">("summary");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [askQ, setAskQ] = useState("");
  const [ans, setAns] = useState<AskAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // List every conversation at or beneath `path` (walks the loaded tree).
  const loadList = useCallback((t: TreeNode | null, path: string) => {
    if (!t) return;
    const convs: TreeNode[] = [];
    const walk = (n: TreeNode) => {
      if (n.kind === "conversation" && (path === "" || n.path === path || n.path.startsWith(path + "/"))) {
        convs.push(n);
      }
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
        loadList(t, ""); // populate Library with everything on load
      })
      .catch((e) => setErr(String(e)));
  }, [loadList]);

  useEffect(() => {
    reloadTree();
    vault.tasks("all").then(setTasks).catch(() => {});
  }, [reloadTree]);

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
    vault.list(parent).then(setList).catch(() => {});
    vault.get(id).then(setConv).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (tab === "transcript" && conv && !transcript) {
      vault.transcript(conv.meta.id).then(setTranscript).catch(() => {});
    }
  }, [tab, conv, transcript]);

  const runSearch = useCallback(() => {
    if (!query.trim()) return;
    vault.search(query, "exact").then(setHits).catch((e) => setErr(String(e)));
  }, [query]);

  const runAsk = useCallback(() => {
    if (!askQ.trim()) return;
    setAsking(true);
    setAns(null);
    vault
      .ask(askQ)
      .then(setAns)
      .catch((e) => setErr(String(e)))
      .finally(() => setAsking(false));
  }, [askQ]);

  const toggleTask = useCallback(
    (t: Task) => {
      vault.toggleTask(t.conv, t.text, !t.done).then(() => {
        setTasks((ts) => ts.map((x) => (x === t ? { ...x, done: !x.done } : x)));
        if (conv && conv.meta.id === t.conv) {
          setConv({
            ...conv,
            notes: {
              ...conv.notes,
              actions: conv.notes.actions.map((a) => (a.text === t.text ? { ...a, done: !a.done } : a)),
            },
          });
        }
      });
    },
    [conv],
  );

  const openTasks = tasks.filter((t) => !t.done);
  const crumb = useMemo(() => folder.split("/").filter(Boolean), [folder]);

  return (
    <div className="v3">
      <div className="v3-bar" data-tauri-drag-region>
        <div className="v3-wordmark">
          <span className="v3-logo">
            <Icon name="logo" size={13} />
          </span>
          Memosa
        </div>
        <div className="v3-omni" onClick={() => setScreen("search")}>
          <Icon name="search" size={15} />
          Search or ask your conversations…
          <span className="kbd">⌘K</span>
        </div>
        <div className="v3-right">
          <div className="v3-mode">
            <span className="dot" /> Bunker
          </div>
          <div
            className="v3-ghost"
            title="Daylight / Vault"
            onClick={() => setTheme((t) => (t === "daylight" ? "vault" : "daylight"))}
          >
            <Icon name="theme" size={17} />
          </div>
        </div>
      </div>

      <div className="v3-body">
        {/* rail */}
        <div className="v3-rail">
          {(["library", "ask", "search", "tasks"] as Screen[]).map((s) => (
            <div
              key={s}
              className={"v3-nav " + (screen === s ? "active" : "")}
              onClick={() => setScreen(s)}
            >
              <Icon name={s} size={16} />
              {s[0].toUpperCase() + s.slice(1)}
              {s === "tasks" && openTasks.length > 0 && <span className="badge">{openTasks.length}</span>}
            </div>
          ))}

          <div className="v3-ghdr">Domains</div>
          {tree?.children?.map((c) => (
            <Tree
              key={c.path}
              node={c}
              depth={0}
              onOpenFolder={openFolder}
              onOpenConv={openConv}
              selectedConv={conv?.meta.id ?? null}
            />
          ))}

          <div className="v3-spacer" />
          <div className="v3-capture">
            <Icon name="capture" size={16} /> Capture <span className="kbd">⌘R</span>
          </div>
          <div className="v3-nav">
            <Icon name="settings" size={16} /> Settings
          </div>
        </div>

        {/* stage */}
        <div className={"v3-stage " + (screen === "library" ? "v3-library" : "")}>
          {err && <div className="v3-empty">⚠ {err}</div>}

          {screen === "library" && (
            <>
              <div className="v3-list">
                <div className="v3-crumb">
                  {crumb.length === 0 ? (
                    <b>All conversations</b>
                  ) : (
                    crumb.map((c, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <Icon name="chevron" size={13} />}
                        {i === crumb.length - 1 ? <b>{c}</b> : <span>{c}</span>}
                      </React.Fragment>
                    ))
                  )}
                </div>
                <div className="v3-listsub">{list.length} CONVERSATIONS</div>
                {list.length === 0 && <div className="v3-empty">Pick a folder to see its conversations.</div>}
                {list.map((m) => (
                  <div
                    key={m.id}
                    className={"v3-row " + (conv?.meta.id === m.id ? "sel" : "")}
                    onClick={() => openConv(m.id)}
                  >
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

              <div className="v3-detail">
                {!conv ? (
                  <div className="v3-notice">
                    <div className="big">Select a conversation</div>
                    Your migrated memory lives here as plain files.
                  </div>
                ) : (
                  <div className="v3-dinner">
                    <div className="v3-dtop">
                      <span className="v3-kicker">
                        {fmtDate(conv.meta.created).toUpperCase()} ·{" "}
                        {conv.meta.duration_sec > 0 ? `${Math.round(conv.meta.duration_sec / 60)} MIN` : "—"}
                      </span>
                      <div className="v3-actions">
                        <div className="v3-iconbtn">
                          <Icon name="download" size={15} /> Export
                        </div>
                      </div>
                    </div>
                    <h1 className="det">{conv.meta.title}</h1>
                    <div className="v3-foldertag">
                      <Icon name="folder" size={14} /> {conv.meta.id.split("/").slice(0, -1).join(" › ")}
                    </div>
                    <div className="v3-tabs">
                      <div className={"v3-tab " + (tab === "summary" ? "active" : "")} onClick={() => setTab("summary")}>
                        Summary
                      </div>
                      <div
                        className={"v3-tab " + (tab === "transcript" ? "active" : "")}
                        onClick={() => setTab("transcript")}
                      >
                        Transcript
                      </div>
                    </div>

                    {tab === "summary" ? (
                      <>
                        {conv.notes.summary ? (
                          <p className="lead">{conv.notes.summary}</p>
                        ) : (
                          <p style={{ color: "var(--muted)" }}>No summary yet.</p>
                        )}
                        {conv.notes.decisions.length > 0 && (
                          <>
                            <div className="v3-seclabel">Decisions</div>
                            {conv.notes.decisions.map((d, i) => (
                              <p key={i}>{d}</p>
                            ))}
                          </>
                        )}
                        {conv.notes.actions.length > 0 && (
                          <>
                            <div className="v3-seclabel">Action items</div>
                            {conv.notes.actions.map((a, i) => (
                              <div key={i} className={"v3-ai " + (a.done ? "done" : "")} onClick={() => toggleTask(a)}>
                                <span className={"v3-check " + (a.done ? "done" : "")}>
                                  {a.done && <Icon name="caret" size={11} />}
                                </span>
                                <div>
                                  <div className="txt">{a.text}</div>
                                  {(a.owner || a.due) && (
                                    <div className="v3-owner">
                                      {[a.owner, a.due].filter(Boolean).join(" · ")}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {!transcript || transcript.segments.length === 0 ? (
                          <p style={{ color: "var(--muted)" }}>No transcript available.</p>
                        ) : (
                          transcript.segments.map((s, i) => (
                            <div key={i} className="v3-utt">
                              <div className="ts">{fmtClock(s.start)}</div>
                              <div>
                                {transcript.speakers[s.speaker] && (
                                  <span className="sp">{transcript.speakers[s.speaker]}</span>
                                )}
                                <div className="txt2">{s.text}</div>
                              </div>
                            </div>
                          ))
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {screen === "search" && (
            <div className="v3-col">
              <div className="v3-colin">
                <div className="v3-bigsearch">
                  <Icon name="search" size={19} />
                  <input
                    autoFocus
                    placeholder="Search your conversations…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  />
                </div>
                <div className="v3-srxmeta">{hits.length} RESULTS</div>
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

          {screen === "tasks" && (
            <div className="v3-col">
              <div className="v3-colin">
                <h1 className="page">Action items</h1>
                <div className="v3-psub">
                  Pulled from every conversation. {openTasks.length} open across the vault.
                </div>
                {tasks.map((t, i) => (
                  <div key={i} className={"v3-task " + (t.done ? "done" : "")}>
                    <span className={"v3-check " + (t.done ? "done" : "")} onClick={() => toggleTask(t)}>
                      {t.done && <Icon name="caret" size={11} />}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="tt">{t.text}</div>
                      <div className="schip">
                        <Icon name="file" size={12} /> {t.conv.split("/").pop()?.replace(/-/g, " ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {screen === "ask" && (
            <div className="v3-col">
              <div className="v3-colin">
                <h1 className="page">Ask your memory</h1>
                <div className="v3-psub">Answered locally from your vault — nothing leaves your Mac.</div>
                <div className="v3-bigsearch">
                  <Icon name="ask" size={19} />
                  <input
                    autoFocus
                    placeholder="What did we decide about…?"
                    value={askQ}
                    onChange={(e) => setAskQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runAsk()}
                  />
                </div>
                {asking && <div className="v3-srxmeta">THINKING…</div>}
                {ans && (
                  <div style={{ marginTop: 18 }}>
                    <p className="lead" style={{ whiteSpace: "pre-wrap" }}>
                      {ans.text}
                    </p>
                    {!ans.grounded && (
                      <div className="v3-srxmeta" style={{ color: "var(--live)" }}>
                        RETRIEVAL ONLY — START A LOCAL MODEL FOR A WRITTEN ANSWER
                      </div>
                    )}
                    {ans.citations.length > 0 && <div className="v3-seclabel">Sources</div>}
                    {ans.citations.map((c) => (
                      <div key={c.n} className="v3-sres" onClick={() => openConv(c.conv)}>
                        <div className="st">
                          [{c.n}] {c.title}
                        </div>
                        <div className="sp">{c.conv.split("/").slice(0, -1).join(" › ")}</div>
                        <div className="snip">{c.quote}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
