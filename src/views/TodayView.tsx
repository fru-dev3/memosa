import { useEffect, useMemo, useState } from 'react'
import { RecordButton } from '../components/today/RecordButton'
import { useCalendar } from '../hooks/useCalendar'
import { useMemosaStore } from '../store'

// Waveform bar heights — natural audio spectrum shape, mirrored
const WAVE_HEIGHTS = [4,6,10,16,24,36,52,64,72,80,86,82,74,64,52,40,30,22,16,12,8,6,10,18,28,40,56,68,78,84,88,82,72,60,48,36,24,16,10,6]

function WaveformDecoration() {
  const W = 600, H = 160
  return (
    <svg
      className="today-wave-art"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {WAVE_HEIGHTS.map((h, i) => (
        <rect
          key={i}
          x={i * (W / WAVE_HEIGHTS.length) + 2}
          y={(H - h) / 2}
          width={Math.max(4, W / WAVE_HEIGHTS.length - 5)}
          height={h}
          rx={Math.min(6, h / 2)}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

const LIVING_QUOTES = [
  'Small progress compounds into a body of work.',
  'Clarity arrives when the noise has somewhere to go.',
  'Capture the moment before it disappears.',
  'A calm system makes better decisions.',
  'Momentum is usually just a record button away.',
  'Thoughts become useful once they are held somewhere.',
]

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.round((totalSeconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function formatTodayDate() {
  return new Date().toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="setting-card today-stat-card">
      <div className="setting-label">{label}</div>
      <div className="setting-value">{value}</div>
      <div className="setting-copy">{detail}</div>
    </div>
  )
}

function WarningBanner({
  title,
  minutes,
  onDismiss,
  onSkip,
}: {
  title: string
  minutes: number
  onDismiss: () => void
  onSkip: () => void
}) {
  return (
    <div className="surface-panel" style={{ background: 'linear-gradient(180deg, rgba(232,168,56,0.12), rgba(255,255,255,0.015))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div className="section-label" style={{ color: 'var(--upcoming)' }}>Auto-record warning</div>
          <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>{title} starts in {minutes} minutes</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="ghost-pill" onClick={onSkip}>Skip once</button>
          <button className="ghost-pill" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  )
}



export function TodayView() {
  const {
    autoRecord,
    meetings,
    profiles,
    recordingStatus,
    selectedProfileId,
    setActiveView,
    setCurrentMeeting,
    setSearchSeed,
  } = useMemosaStore()
  const { warning, dismissWarning, dismissAndSkipRecord } = useCalendar()
  const [loading, setLoading] = useState(true)
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * LIVING_QUOTES.length))

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 400)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % LIVING_QUOTES.length)
    }, 18000)

    return () => window.clearInterval(interval)
  }, [])

  // Group recent meetings by date, max 2 per day, last 4 days
  const recentByDay = useMemo(() => {
    const sorted = [...meetings].sort((a, b) => `${b.date}${b.start_time}`.localeCompare(`${a.date}${a.start_time}`))
    const groups: { date: string; shown: typeof meetings; extra: number }[] = []
    const seen = new Set<string>()
    for (const meeting of sorted) {
      if (!seen.has(meeting.date)) {
        seen.add(meeting.date)
        const dayMeetings = sorted.filter((m) => m.date === meeting.date)
        groups.push({ date: meeting.date, shown: dayMeetings.slice(0, 2), extra: Math.max(0, dayMeetings.length - 2) })
        if (groups.length >= 4) break
      }
    }
    return groups
  }, [meetings])

  const activeProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0]
  const todayLabel = formatTodayDate()

  const stats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10)
    const todaysMeetings = meetings.filter((meeting) => meeting.date === todayKey)
    const duration = todaysMeetings.reduce((sum, meeting) => sum + meeting.duration_seconds, 0)
    return {
      conversations: todaysMeetings.length,
      recorded: duration,
      pending: meetings.filter((meeting) => meeting.transcription_status === 'processing').length,
      summaries: meetings.filter((meeting) => meeting.summary).length,
      hasAnyMeetings: meetings.length > 0,
    }
  }, [meetings])

  const heroTitle = recordingStatus.is_recording
    ? 'Recording is live.'
    : loading
    ? 'Preparing your capture space.'
    : stats.conversations > 0
    ? `${stats.conversations} ${stats.conversations === 1 ? 'conversation' : 'conversations'} captured today.`
    : stats.hasAnyMeetings
    ? 'Quiet day so far.'
    : 'A cleaner way to start the moment.'

  const heroSubtext = recordingStatus.is_recording
    ? 'Memosa is capturing locally on this Mac right now.'
    : stats.conversations > 0
    ? `${formatDuration(stats.recorded)} recorded locally today.`
    : stats.hasAnyMeetings
    ? 'Your previous recordings are in the library when you need them.'
    : 'Make recording the center of the page, then let everything else support it.'

  const openSearchFor = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  const openMeeting = (meetingId: string) => {
    const target = meetings.find((meeting) => meeting.id === meetingId)
    if (!target) return
    setCurrentMeeting(target)
    setActiveView('library')
  }

  return (
    <div className="page-shell">
      {warning && (
        <div style={{ marginBottom: 18 }}>
          <WarningBanner
            title={warning.event.title}
            minutes={Math.round(warning.seconds_until / 60)}
            onDismiss={dismissWarning}
            onSkip={dismissAndSkipRecord}
          />
        </div>
      )}

      <section className="today-stage">
        <div className="today-stage-dot-grid" aria-hidden="true" />
        <WaveformDecoration />
        <div className="today-stage-main">
          <div className="today-stage-copy">
            <div className="eyebrow">Today</div>
            <div className="today-stage-title">{heroTitle}</div>
            <div className="today-stage-text">{heroSubtext}</div>
            <div className="today-hero-note-band">
              <div className="today-date-pill">{todayLabel}</div>
              <div className="living-note" key={quoteIndex}>
                <span className="living-note-dot" aria-hidden="true" />
                <span>{LIVING_QUOTES[quoteIndex]}</span>
              </div>
            </div>
            <div className="today-stage-meta">
              <span className={`chip ${recordingStatus.is_recording ? 'chip-danger' : 'chip-success'}`}>
                {recordingStatus.is_recording ? 'recording' : 'idle'}
              </span>
              <span className={`chip ${autoRecord ? 'chip-success' : 'chip-muted'}`}>auto-record {autoRecord ? 'on' : 'off'}</span>
              <span className="stat-inline">{activeProfile.name}</span>
            </div>
          </div>

          <div className="today-stage-recorder-wrap">
            <div className="today-stage-orbit today-stage-orbit-a" aria-hidden="true" />
            <div className="today-stage-orbit today-stage-orbit-b" aria-hidden="true" />
            <div className="today-stage-node today-stage-node-a" aria-hidden="true" />
            <div className="today-stage-node today-stage-node-b" aria-hidden="true" />
            <div className="today-stage-node today-stage-node-c" aria-hidden="true" />
            <div className="today-stage-recorder">
              <RecordButton />
            </div>
          </div>
        </div>

        <div className="today-stage-stats">
          <StatCard label="Conversations" value={stats.conversations > 0 ? String(stats.conversations) : '—'} detail="Today" />
          <StatCard label="Recorded time" value={stats.recorded > 0 ? formatDuration(stats.recorded) : '—'} detail="Saved locally" />
          <StatCard label="In queue" value={stats.pending > 0 ? String(stats.pending) : '—'} detail="Transcription jobs" />
          <StatCard label="Summaries" value={stats.summaries > 0 ? String(stats.summaries) : '—'} detail="Available now" />
        </div>
      </section>

      <section className="surface-panel">
        <div className="panel-header">
          <div className="section-label">Recent recordings</div>
          <button className="ghost-pill" onClick={() => setActiveView('library')}>View all</button>
        </div>
        <div>
          {loading ? (
            <div className="skeleton" style={{ height: 48, borderRadius: 10 }} />
          ) : recentByDay.length === 0 ? (
            <div style={{ padding: '14px 0 4px', fontSize: 12, color: 'var(--text-muted)' }}>
              {stats.hasAnyMeetings ? 'Nothing recorded today. Previous recordings are in the library.' : 'No recordings yet. Press record to start your first capture.'}
            </div>
          ) : (
            recentByDay.map(({ date, shown, extra }) => (
              <div key={date} className="today-day-group">
                <div className="today-day-label">
                  {new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                {shown.map((meeting) => (
                  <div
                    key={meeting.id}
                    className="today-rec-row"
                    onClick={() => openMeeting(meeting.id)}
                  >
                    <span className="today-rec-status">
                      {meeting.transcription_status === 'complete' ? (
                        <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" fill="color-mix(in srgb, #22c55e 15%, transparent)" stroke="#22c55e" strokeWidth="1"/><path d="M3.5 6.5L5.5 8.5L9.5 4.5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : meeting.transcription_status === 'failed' ? (
                        <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" fill="color-mix(in srgb, #ef4444 12%, transparent)" stroke="#ef4444" strokeWidth="1"/><path d="M4.5 4.5L8.5 8.5M8.5 4.5L4.5 8.5" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="var(--border-subtle)" strokeWidth="1"/><circle cx="6.5" cy="6.5" r="2" fill="var(--text-muted)"/></svg>
                      )}
                    </span>
                    <span className="today-rec-title">{meeting.title || 'Untitled'}</span>
                    <span className="today-rec-meta">{meeting.start_time} · {formatDuration(meeting.duration_seconds)}</span>
                  </div>
                ))}
                {extra > 0 && (
                  <div className="today-rec-more">+{extra} more</div>
                )}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
