// People, accounts and topic tags on a conversation: chips plus one field that
// finds or creates any of them. Used on a conversation and in the floating recorder.
import React, { useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import type { Directory, Entity, LinkKind, Links, Suggested } from "../lib/vault";

const ICON: Record<LinkKind, string> = { person: "person", account: "account", tag: "tag" };
const FIELD: Record<LinkKind, keyof Links> = { person: "people", account: "accounts", tag: "tags" };

export type Option = { kind: LinkKind; name: string; hint?: string; isNew?: boolean };

// Matches for what is typed: known names first, then "new person / account / tag".
export function options(q: string, dir: Directory | null, links: Links): Option[] {
  const raw = q.trim();
  if (!raw) return [];
  const tagOnly = raw.startsWith("#");
  const text = raw.replace(/^[#@]/, "").trim();
  const t = text.toLowerCase();
  if (!t) return [];
  const linked = (k: LinkKind, n: string) => links[FIELD[k]].some((x) => x.toLowerCase() === n.toLowerCase());
  const out: Option[] = [];
  if (!tagOnly) {
    for (const e of dir?.entities ?? []) {
      const hit = [e.name, ...e.aliases].some((n) => n.toLowerCase().includes(t));
      if (hit && !linked(e.kind, e.name)) out.push({ kind: e.kind, name: e.name, hint: e.kind === "person" ? e.account ?? undefined : undefined });
    }
  }
  for (const g of dir?.tags ?? []) if (g.name.includes(t.replace(/\s+/g, "-")) && !linked("tag", g.name)) out.push({ kind: "tag", name: g.name });
  const exact = (k: LinkKind) => out.some((o) => o.kind === k && o.name.toLowerCase() === t);
  if (!tagOnly) {
    if (!exact("person")) out.push({ kind: "person", name: text, isNew: true });
    if (!exact("account")) out.push({ kind: "account", name: text, isNew: true });
  }
  const tag = t.replace(/\s+/g, "-");
  if (!out.some((o) => o.kind === "tag" && o.name === tag) && !linked("tag", tag)) out.push({ kind: "tag", name: tag, isNew: true });
  return out.slice(0, 8);
}

export function LinkEditor({
  links,
  suggested,
  dir,
  onChange,
  onAnswer,
  onOpen,
  onFocus,
  placeholder = "Add a person, account or #tag",
}: {
  links: Links;
  suggested?: Suggested;
  dir: Directory | null;
  onChange: (l: Links) => void;
  onAnswer?: (kind: LinkKind, name: string, accept: boolean) => void;
  onOpen?: (kind: LinkKind, name: string) => void;
  onFocus?: (open: boolean) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const opts = useMemo(() => options(q, dir, links), [q, dir, links]);
  const accountOf = (name: string) => dir?.entities.find((e) => e.kind === "person" && e.name === name)?.account;

  const add = (o: Option) => {
    const f = FIELD[o.kind];
    onChange({ ...links, [f]: [...links[f], o.name] });
    setQ("");
    setHi(0);
    input.current?.focus();
  };
  const remove = (k: LinkKind, name: string) => {
    const f = FIELD[k];
    onChange({ ...links, [f]: links[f].filter((x) => x !== name) });
  };

  const chips: { kind: LinkKind; name: string }[] = [
    ...links.people.map((name) => ({ kind: "person" as const, name })),
    ...links.accounts.map((name) => ({ kind: "account" as const, name })),
    ...links.tags.map((name) => ({ kind: "tag" as const, name })),
  ];
  const guesses: { kind: LinkKind; name: string }[] = suggested
    ? [
        ...suggested.people.map((name) => ({ kind: "person" as const, name })),
        ...suggested.accounts.map((name) => ({ kind: "account" as const, name })),
        ...suggested.tags.map((name) => ({ kind: "tag" as const, name })),
      ]
    : [];

  return (
    <div className="v3-links">
      <div className="v3-chips">
        {chips.map((c) => (
          <span key={c.kind + c.name} className={"v3-chip " + c.kind}>
            <button className="nm" onClick={() => onOpen?.(c.kind, c.name)} title={c.kind === "person" && accountOf(c.name) ? `${c.name}, ${accountOf(c.name)}` : c.name}>
              <Icon name={ICON[c.kind]} size={13} />
              {c.name}
            </button>
            <button className="x" aria-label={`Remove ${c.name}`} onClick={() => remove(c.kind, c.name)}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {guesses.map((c) => (
          <span key={"s" + c.kind + c.name} className={"v3-chip guess " + c.kind} title="Suggested from the conversation">
            <Icon name={ICON[c.kind]} size={13} />
            <span className="nm">{c.name}?</span>
            <button className="ok" aria-label={`Add ${c.name}`} onClick={() => onAnswer?.(c.kind, c.name, true)}>
              <Icon name="check" size={12} />
            </button>
            <button className="x" aria-label={`Dismiss ${c.name}`} onClick={() => onAnswer?.(c.kind, c.name, false)}>
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        <span className="v3-chipadd">
          <input
            ref={input}
            value={q}
            placeholder={chips.length + guesses.length ? "Add" : placeholder}
            aria-label={placeholder}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onFocus={() => onFocus?.(true)}
            onBlur={() => window.setTimeout(() => onFocus?.(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHi((h) => Math.min(h + 1, opts.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHi((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter" && opts[hi]) {
                e.preventDefault();
                add(opts[hi]);
              } else if (e.key === "Escape") {
                setQ("");
              } else if (e.key === "Backspace" && !q && chips.length) {
                const last = chips[chips.length - 1];
                remove(last.kind, last.name);
              }
            }}
          />
        </span>
      </div>
      {opts.length > 0 && (
        <div className="v3-linkmenu" role="listbox">
          {opts.map((o, i) => (
            <button
              key={o.kind + o.name + (o.isNew ? "+" : "")}
              role="option"
              aria-selected={i === hi}
              className={"v3-linkopt " + (i === hi ? "hi" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHi(i)}
              onClick={() => add(o)}
            >
              <Icon name={ICON[o.kind]} size={14} />
              {o.isNew ? (
                <span>
                  New {o.kind === "tag" ? "tag" : o.kind}: <b>{o.kind === "tag" ? "#" + o.name : o.name}</b>
                </span>
              ) : (
                <span>
                  <b>{o.kind === "tag" ? "#" + o.name : o.name}</b>
                  {o.hint ? <span className="hint">, {o.hint}</span> : null}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The head of the list when it shows one person, account or #tag: who they are,
// where they work, other names, and free notes (the note file in the vault).
export function EntityHeader({
  filter,
  entity,
  accounts,
  count,
  onOpen,
  onSave,
  onAll,
}: {
  filter: { kind: LinkKind; name: string };
  entity: Entity | null;
  accounts: string[];
  count: number;
  onOpen: (kind: LinkKind, name: string) => void;
  onSave: (e: Entity, oldName?: string) => void;
  onAll: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(filter.name);
  const [account, setAccount] = useState(entity?.account ?? "");
  const [aliases, setAliases] = useState((entity?.aliases ?? []).join(", "));
  const [body, setBody] = useState(entity?.body ?? "");
  const label = filter.kind === "person" ? "People" : filter.kind === "account" ? "Accounts" : "Tags";

  const save = () => {
    if (!entity) return;
    onSave(
      {
        ...entity,
        name: name.trim() || entity.name,
        account: account.trim() || null,
        aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
      },
      entity.name,
    );
    setEditing(false);
  };

  return (
    <div className="v3-entity">
      <div className="v3-crumb">
        <button onClick={onAll}>All</button>
        <Icon name="chevron" size={13} />
        <span>{label}</span>
      </div>
      <h2 className="v3-entname">
        <Icon name={filter.kind} size={18} /> {filter.kind === "tag" ? "#" + filter.name : filter.name}
      </h2>
      {entity && !editing && (
        <div className="sub">
          {entity.kind === "person" &&
            (entity.account ? (
              <>
                Works at
                <button onClick={() => onOpen("account", entity.account!)}>{entity.account}</button>
              </>
            ) : null)}
          {entity.aliases.length > 0 && <span>Also called {entity.aliases.join(", ")}</span>}
          <button onClick={() => setEditing(true)}>{entity.kind === "person" && !entity.account ? "Add where they work" : "Edit"}</button>
        </div>
      )}
      {entity && editing && (
        <div className="v3-entform">
          <label>
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {entity.kind === "person" && (
            <label>
              <span>Works at</span>
              <input value={account} list="v3-accounts" placeholder="Account, e.g. a company" onChange={(e) => setAccount(e.target.value)} />
              <datalist id="v3-accounts">
                {accounts.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </label>
          )}
          <label>
            <span>Other names</span>
            <input value={aliases} placeholder="Comma separated" onChange={(e) => setAliases(e.target.value)} />
          </label>
          <div className="acts">
            <button className="v3-btn primary sm" onClick={save}>
              Save
            </button>
            <button className="v3-btn sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {entity && (
        <textarea
          value={body}
          placeholder={`Notes about ${entity.name}`}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => body !== entity.body && onSave({ ...entity, body })}
        />
      )}
      <div className="v3-listsub">
        {count} {count === 1 ? "conversation" : "conversations"}
        {filter.kind === "account" ? ", with its people" : ""}
      </div>
    </div>
  );
}
