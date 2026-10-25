// The floating recorder (window "pill"): stays on top while a call is recorded so
// the main window can be put away. Clock, level, Stop, and the call's people,
// accounts and tags. Stop is done by the main window, which owns the recording.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Icon } from "./icons";
import { LinkEditor } from "./Links";
import { vault, type Directory, type Links } from "../lib/vault";
import "./v3.css";

const fmtClock = (sec: number) =>
  `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export default function Pill() {
  const params = new URLSearchParams(window.location.search);
  const started = Number(params.get("started")) || Date.now();
  const title = params.get("title") || "Recording";
  const [sec, setSec] = useState(Math.max(0, (Date.now() - started) / 1000));
  const [levels, setLevels] = useState<number[]>(() => Array(14).fill(0));
  const [links, setLinks] = useState<Links>({ people: [], accounts: [], tags: [] });
  const [dir, setDir] = useState<Directory | null>(null);
  const [stopping, setStopping] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "vault" : "daylight";
    vault.captureLinks().then(setLinks).catch(() => {});
    vault.directory().then(setDir).catch(() => {});
    const t = window.setInterval(() => setSec((Date.now() - started) / 1000), 500);
    const un = listen<{ level: number }>("audio-level", (e) =>
      setLevels((ls) => [...ls.slice(1), Math.max(0, Math.min(1, Number(e.payload?.level) || 0))]),
    );
    return () => {
      window.clearInterval(t);
      void un.then((f) => f());
    };
  }, [started]);

  // The window follows its content: taller while the tag list is open.
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(box.current?.getBoundingClientRect().height ?? 0);
      if (h) void invoke("pill_resize", { height: h });
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const change = (l: Links) => {
    setLinks(l);
    vault.setCaptureLinks(l).catch(() => {});
  };

  return (
    <div className="v3 v3-pillroot">
      <div className="v3-pill" ref={box}>
        <div
          className="v3-pillbar"
          onMouseDown={(e) => {
            if (e.button === 0 && !(e.target as HTMLElement).closest("button")) void invoke("start_window_drag");
          }}
        >
          <span className="grip">
            <Icon name="grip" size={14} />
          </span>
          <span className="v3-recdot" />
          <span className="v3-rectime">{fmtClock(sec)}</span>
          <span className="v3-pilltitle" title={title}>
            {title}
          </span>
          <span className="v3-pillwave" aria-hidden>
            {levels.map((l, i) => (
              <i key={i} style={{ height: `${Math.max(12, Math.min(100, Math.sqrt(l) * 160))}%` }} />
            ))}
          </span>
          <button
            className="v3-btn primary sm"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              void emit("pill-stop");
            }}
          >
            <Icon name="stop" size={13} /> {stopping ? "Saving" : "Stop"}
          </button>
        </div>
        <LinkEditor links={links} dir={dir} onChange={change} placeholder="Who is this with? Add a person, account or #tag" />
      </div>
    </div>
  );
}
