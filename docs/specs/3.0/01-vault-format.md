# 01 — Vault File Format & Schemas  ⟨CONTRACT — freeze before fan-out⟩

The on-disk truth. Every other module reads/writes these exact shapes. No DB.

## Directory layout
```
~/Documents/fru/vault/memosa/
├─ <Domain>/                         # any directory = a domain/folder; nests arbitrarily
│  └─ <Folder>/                      #   e.g. Life/Dad/Medical/
│     └─ <conversation-slug>/        #   a dir containing meta.json == a conversation
│        ├─ meta.json                #   conversation metadata
│        ├─ transcript.json          #   segments (timestamps + speakers)
│        ├─ transcript.txt           #   derived plaintext (for grep / dumb AI ingestion)
│        ├─ notes.md                 #   summary + decisions + action items (Markdown)
│        └─ audio.m4a                #   original recording (NEVER synced to Drive)
└─ .memosa/                          # app-managed, hidden; fully rebuildable
   ├─ config.json                    # app settings (theme, model policy, vault prefs)
   ├─ index/
   │  ├─ embeddings.jsonl            # one JSON per chunk
   │  ├─ tasks.jsonl                 # derived action-item index (from notes.md)
   │  └─ manifest.json               # path → {hash,mtime} for change detection
   └─ speakers.json                  # cross-meeting voice fingerprints (future)
```

## Identity rules
- A directory is a **conversation** iff it contains `meta.json`. Otherwise it's a **folder**.
- A conversation's canonical id = its vault-relative path, e.g. `Life/Dad/2026-06-17-obie-insurance-review`.
- Slug = `YYYY-MM-DD-kebab-title`, deduped with `-2`, `-3` on collision.
- `.memosa/` and dotfiles are ignored when walking the tree.

## meta.json  (schema v1)
```json
{
  "schema": 1,
  "id": "Life/Dad/2026-06-17-obie-insurance-review",
  "title": "Obie Insurance review",
  "created": "2026-06-17T11:02:00Z",
  "duration_sec": 2520,
  "people": ["Sarah Chen", "Mike Reyes", "Fru"],
  "tags": ["insurance", "home"],
  "source": "recording",                 // recording | import | calendar
  "calendar_event_id": null,
  "audio": "audio.m4a",
  "updated": "2026-06-17T11:46:00Z"
}
```

## transcript.json  (schema v1)
```json
{
  "schema": 1,
  "language": "en",
  "model": "whisper-large-v3",
  "speakers": { "S1": "Sarah Chen", "S2": "Mike Reyes" },
  "segments": [
    { "start": 12.0, "end": 18.6, "speaker": "S1", "text": "So the water-damage rider…" }
  ]
}
```
`transcript.txt` = derived: `[mm:ss] Speaker: text` lines. Always regenerated from json.

## notes.md  (Markdown is source of truth for summary + tasks)
```markdown
---
title: Obie Insurance review
date: 2026-06-17
people: [Sarah Chen, Mike Reyes, Fru]
tags: [insurance, home]
---

## Summary
Compared three renter's policies…

## Decisions
- Proceed with Obie including the water-damage rider.

## Action items
- [ ] Send Obie the signed W-9  <!-- owner: Fru; due: 2026-06-19 -->
- [x] Request itemized estate inventory  <!-- owner: Fru -->
```
Action items are GFM checkboxes; optional HTML-comment metadata (`owner`, `due`, `source`).
The trailing comment is the machine channel; the visible text stays clean.

## .memosa/index/embeddings.jsonl  (one object per line)
```json
{"conv":"Life/Dad/2026-06-17-obie-insurance-review","chunk":3,"start":58.0,"text":"…","vector":[0.0123, …]}
```

## .memosa/index/tasks.jsonl  (derived from every notes.md)
```json
{"conv":"…obie-insurance-review","text":"Send Obie the signed W-9","done":false,"owner":"Fru","due":"2026-06-19"}
```

## Write discipline (all modules MUST follow)
- **Atomic writes:** write `*.tmp` in the same dir, `fsync`, then `rename` over the target.
- **UTF-8**, `\n` line endings, 2-space JSON indentation (jsonl = compact, one line each).
- **Never** hold a long-lived lock; the vault must stay externally editable.
- All timestamps **UTC ISO-8601**. All paths vault-relative with `/` separators.

## Acceptance
A hand-authored conversation folder (no app) is fully readable by the app; an app-authored
one is human-readable and round-trips through git diff cleanly.
