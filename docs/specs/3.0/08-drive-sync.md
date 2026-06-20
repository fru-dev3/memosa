# 08 — Google Drive Sync (text only)

Back up + extend reach of the vault. **Text only — audio never leaves the Mac.** Depends on
**01, 02**. Decided: sync transcripts/notes/summaries; exclude `audio.m4a`.

## Scope
- Synced: `meta.json`, `transcript.json`, `transcript.txt`, `notes.md`, and the folder
  structure. **Excluded always:** `audio.m4a`, `.memosa/index/` (rebuildable), trash.
- Mirrors the vault directory tree into a Drive folder (`Memosa/`), preserving Domains/Folders.

## Engine
- Google Drive API (file scope). Token in Keychain.
- One-way mirror first (local → Drive) with change detection via the manifest hashes; add
  pull/merge later. Conflicts: last-writer-wins with a `.conflict` copy, never destructive.
- `sync_status()`, `sync_now()`, `sync_set(cfg)`; progress via `sync_progress` events.

## Privacy gate
- While in **Bunker** mode, enabling sync requires an explicit confirm dialog naming exactly
  what leaves the device (text, not audio). Off by default. Honors the model/redaction posture.

## Acceptance
Enabling sync uploads a conversation's text files (not its audio) into `Drive/Memosa/<Domain>/
<Folder>/<conv>/`; re-running syncs only changed files; audio is provably absent in Drive.
