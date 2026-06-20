# 07 — Calendar & Auto-record (Google)

Connect Google Calendar; auto-capture meetings and auto-file them. Depends on **01,02,04**.

## Auth
- Google OAuth (Calendar read-only scope). Token in macOS Keychain, not on disk in plaintext.
- `calendar_connect()` runs the flow; `calendar_status()` reports account + connected state.
- Reuse existing calendar module/setup where present (`docs/google-calendar-setup.md`).

## Upcoming + auto-record
- Poll upcoming events; `calendar_upcoming()` → `CalEvent[] {id,title,start,end,attendees,video}`.
- `autorecord_set(cfg)`:
  ```json
  { "enabled":true, "ask_first":true, "min_attendees":2, "video_only":false }
  ```
- At a matching event's start: if `ask_first`, emit `autorecord_prompt {event}` (confirm 1 min
  before; never silent); else begin `capture_start` automatically.

## Auto-file
- Suggest a destination folder from the event (title keywords + attendees → existing domain/
  folder; fall back to a default). User can override in the prompt.
- Set `meta.source="calendar"`, `calendar_event_id`, and `people` from attendees.

## Acceptance
A calendar meeting with ≥2 attendees triggers a confirm prompt at start; accepting records and
files it into the suggested folder with attendees populated. Declining records nothing.
