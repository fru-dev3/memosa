import { useMemosaStore } from '../../store'
import { useRecording } from '../../hooks/useRecording'
import type { CalendarEvent } from '../../lib/types'

// ─── Helpers ──────────────────────────────────────────────────────

type MeetingState = 'live' | 'upcoming' | 'past'

function getMeetingState(event: CalendarEvent): MeetingState {
  const now = Date.now()
  const start = new Date(event.start).getTime()
  const end = new Date(event.end).getTime()
  if (now >= start && now <= end) return 'live'
  if (now < start) return 'upcoming'
  return 'past'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function minutesUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000))
}

function formatAttendees(attendees: string[]): string {
  if (!attendees.length) return ''
  // Show email localparts or full names
  const names = attendees.map(a => a.split('@')[0].replace(/\./g, ' '))
  if (names.length <= 2) return names.join(', ')
  return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

function generateMeetingId(eventId: string) {
  return `cal-${eventId}-${Date.now()}`
}

// ─── Tier 1: Live card ────────────────────────────────────────────

function LiveMeetingCard({
  event,
  isCurrentlyRecording,
  onRecord,
}: {
  event: CalendarEvent
  isCurrentlyRecording: boolean
  onRecord: () => void
}) {
  return (
    <div
      className="card-reveal"
      style={{
        borderRadius: 20,
        border: '1px solid var(--live-border)',
        background: 'rgba(255,255,255,0.76)',
        boxShadow: '0 18px 34px rgba(194,65,12,0.08)',
        overflow: 'hidden',
      }}
    >
      {/* Top accent line */}
      <div style={{ height: 2, background: 'var(--live)', opacity: 0.7 }} />

      <div style={{ padding: '16px 20px 18px' }}>
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="live-dot"
              style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)', display: 'block', flexShrink: 0 }}
            />
            <span className="chip chip-live" style={{ fontSize: 9 }}>Live</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTime(event.start)} – {formatTime(event.end)}
          </span>
        </div>

        {/* Title */}
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 6 }}>
          {event.title}
        </h3>

        {/* Meta */}
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1 }}>
          {event.attendees.length > 0 && <span>{formatAttendees(event.attendees)}</span>}
          {event.calendar_name && (
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>· {event.calendar_name}</span>
          )}
        </div>

        {/* Action */}
        {isCurrentlyRecording ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="live-dot"
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--live)', display: 'block', flexShrink: 0 }}
            />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--live)' }}>Recording in progress</span>
          </div>
        ) : (
          <button
            onClick={onRecord}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 7,
              border: '1px solid var(--live-border)',
              background: 'var(--live-dim)',
              color: 'var(--live)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 120ms ease',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(240,92,92,0.18)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'var(--live-dim)'}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--live)', display: 'inline-block' }} />
            Record Now
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Tier 2: Upcoming card ────────────────────────────────────────

function UpcomingMeetingCard({
  event,
  autoRecord,
  isRecordingAnything,
  onRecord,
}: {
  event: CalendarEvent
  autoRecord?: boolean
  isRecordingAnything: boolean
  onRecord: () => void
}) {
  const minsUntil = minutesUntil(event.start)

  return (
    <div
      className="card-reveal"
      style={{
        borderRadius: 20,
        border: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.72)',
        padding: '16px 18px',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border-strong)'
        el.style.boxShadow = '0 16px 28px rgba(58,45,34,0.08)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.borderColor = 'var(--border)'
        el.style.boxShadow = 'none'
      }}
    >
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="chip chip-upcoming">
          ○ In {minsUntil} min
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(event.start)} – {formatTime(event.end)}
        </span>
      </div>

      {/* Title */}
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 5 }}>
        {event.title}
      </h3>

      {/* Meta */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {event.attendees.length > 0 && <span>{formatAttendees(event.attendees)}</span>}
        {event.location && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {event.location}</span>}
      </div>

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {autoRecord ? (
          <span className="chip chip-success" style={{ fontSize: 9 }}>● Auto-record</span>
        ) : (
          <span />
        )}

        {!isRecordingAnything && (
          <button
            onClick={onRecord}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)',
              fontSize: 11,
              fontWeight: 500,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 120ms ease, border-color 120ms ease',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement
              el.style.color = 'var(--accent)'
              el.style.borderColor = 'var(--accent-border)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement
              el.style.color = 'var(--text-secondary)'
              el.style.borderColor = 'var(--border-strong)'
            }}
          >
            Record
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Tier 3: Past row ─────────────────────────────────────────────

function PastMeetingRow({ event }: { event: CalendarEvent }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        borderRadius: 8,
        cursor: 'default',
        transition: 'background 100ms ease',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
    >
      {/* Check dot */}
      <span style={{ color: 'var(--accent)', fontSize: 11, flexShrink: 0, lineHeight: 1 }}>✓</span>

      {/* Time */}
      <span style={{
        fontSize: 11,
        color: 'var(--text-muted)',
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
        minWidth: 40,
      }}>
        {formatTime(event.start)}
      </span>

      {/* Title */}
      <span style={{
        fontSize: 13,
        color: 'var(--text-secondary)',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {event.title}
      </span>

      {/* Duration */}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
        {formatDuration(event.start, event.end)}
      </span>
    </div>
  )
}

// ─── Default export — dispatches to the right tier ────────────────

interface MeetingCardProps {
  event: CalendarEvent
  autoRecord?: boolean
}

export function MeetingCard({ event, autoRecord }: MeetingCardProps) {
  const { recordingStatus } = useMemosaStore()
  const { startRecording } = useRecording()

  const state = getMeetingState(event)
  const isCurrentlyRecording = recordingStatus.is_recording &&
    !!recordingStatus.meeting_id?.startsWith(`cal-${event.id}`)

  const handleRecord = () => {
    const id = generateMeetingId(event.id)
    startRecording(id, event.title).catch(console.error)
  }

  if (state === 'live') {
    return (
      <LiveMeetingCard
        event={event}
        isCurrentlyRecording={isCurrentlyRecording}
        onRecord={handleRecord}
      />
    )
  }

  if (state === 'upcoming') {
    return (
      <UpcomingMeetingCard
        event={event}
        autoRecord={autoRecord}
        isRecordingAnything={recordingStatus.is_recording}
        onRecord={handleRecord}
      />
    )
  }

  return <PastMeetingRow event={event} />
}

// ─── Export state helper for TodayView ────────────────────────────

export { getMeetingState }
