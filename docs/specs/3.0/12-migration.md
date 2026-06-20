# 12 — Migration: existing data → file vault (one-off)

The current app stored conversations in `~/.memosa/memosa.db` (the *old* architecture). 3.0 is
files-only; this one-time importer lifts existing data out into the vault, then the DB is
retired. Depends on **01, 02**.

## Task
- Read the existing `~/.memosa/` data (meetings: title/date/transcript/summary/action items/
  people/tags/audio path). This is the **only** place the old DB is touched — read-only, once.
- For each meeting, create a vault conversation folder under a best-guess domain
  (default `Imported/` or by existing tag) with:
  - `meta.json` (from row fields), `transcript.json` (+ `.txt`), `notes.md` (summary +
    decisions + action items), and copy the audio in as `audio.m4a` if present.
- Rebuild the index (spec 03) from the new files.
- Emit a report: N conversations migrated, M audio files copied, any skips.

## Rules
- Non-destructive: never modify or delete the old DB; just read. Idempotent: re-running skips
  conversations already present (by created-time + title).
- After verification the user can delete `~/.memosa/` manually; the app no longer reads it.

## Acceptance
Running the importer yields a populated `vault/memosa/` whose conversation count matches the
old data; spot-checked transcripts/summaries match; the app then runs entirely from files.
