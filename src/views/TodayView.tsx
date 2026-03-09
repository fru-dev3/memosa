import { useEffect, useMemo, useState } from 'react'
import { RecordButton } from '../components/today/RecordButton'
import { useCalendar } from '../hooks/useCalendar'
import { useMemosaStore } from '../store'


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

function relativeDate(dateStr: string) {
  const todayKey = new Date().toISOString().slice(0, 10)
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const yesterdayKey = d.toISOString().slice(0, 10)
  if (dateStr === todayKey) return 'Today'
  if (dateStr === yesterdayKey) return 'Yesterday'
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
}

function NoModelBanner({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="surface-panel" style={{
      background: 'linear-gradient(180deg, var(--accent-dim), transparent)',
      border: '1px solid var(--accent-border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div>
        <div className="section-label" style={{ color: 'var(--accent)' }}>No transcription model</div>
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Download a Whisper model to transcribe on-device — no internet needed. Models range from 150 MB (fast) to 500 MB (most accurate).
        </div>
      </div>
      <button className="ghost-pill is-selected-pill" onClick={onGoToSettings} style={{ flexShrink: 0 }}>
        Download model
      </button>
    </div>
  )
}

function WarningBanner({
  title, minutes, onDismiss, onSkip,
}: {
  title: string; minutes: number; onDismiss: () => void; onSkip: () => void
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
    availableModels,
    meetings,
    profiles,
    recordingStatus,
    selectedProfileId,
    setActiveView,
    setCurrentMeeting,
    setSearchSeed,
  } = useMemosaStore()
  const hasModel = availableModels.length > 0 && availableModels.some(m => m.downloaded)
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

  const recentByDay = useMemo(() => {
    const sorted = [...meetings].sort((a, b) => `${b.date}${b.start_time}`.localeCompare(`${a.date}${a.start_time}`))
    const groups: { date: string; shown: typeof meetings; extra: number }[] = []
    const dayMap = new Map<string, typeof meetings>()
    const dayOrder: string[] = []
    for (const meeting of sorted) {
      if (!dayMap.has(meeting.date)) {
        dayMap.set(meeting.date, [])
        dayOrder.push(meeting.date)
        if (dayOrder.length > 4) break
      }
      dayMap.get(meeting.date)!.push(meeting)
    }
    for (const date of dayOrder.slice(0, 4)) {
      const dayMeetings = dayMap.get(date)!
      groups.push({ date, shown: dayMeetings.slice(0, 3), extra: Math.max(0, dayMeetings.length - 3) })
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
      archive: meetings.length,
      hasAnyMeetings: meetings.length > 0,
    }
  }, [meetings])

  const heroTitle = recordingStatus.is_recording
    ? 'Recording is live.'
    : loading
    ? 'Preparing your space.'
    : stats.conversations > 0
    ? `${stats.conversations} ${stats.conversations === 1 ? 'conversation' : 'conversations'} today.`
    : stats.hasAnyMeetings
    ? 'Quiet day so far.'
    : 'Start with a record.'

const openMeeting = (meetingId: string) => {
    const target = meetings.find((meeting) => meeting.id === meetingId)
    if (!target) return
    setCurrentMeeting(target)
    setActiveView('projects')
  }

  const openSearchFor = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  void openSearchFor

  return (
    <div className="page-shell">
      {!loading && !hasModel && <NoModelBanner onGoToSettings={() => setActiveView('settings')} />}
      {warning && (
        <div style={{ marginBottom: 0 }}>
          <WarningBanner
            title={warning.event.title}
            minutes={Math.round(warning.seconds_until / 60)}
            onDismiss={dismissWarning}
            onSkip={dismissAndSkipRecord}
          />
        </div>
      )}

      {/* ── Hero stage ── */}
      <section className="today-stage">
        <div className="today-stage-dot-grid" aria-hidden="true" />

        <div className="today-stage-inner">
          {/* Top bar: date + status chips */}
          <div className="today-top-bar">
            <span className="today-date-pill">{todayLabel}</span>
            <span className={`chip ${recordingStatus.is_recording ? 'chip-danger' : 'chip-success'}`}>
              {recordingStatus.is_recording ? 'recording' : 'idle'}
            </span>
            {autoRecord && <span className="chip chip-success">auto-record on</span>}
            <span className="stat-inline">{activeProfile?.name ?? 'Default'}</span>
          </div>

          {/* Title + subtext */}
          <div className="today-hero-copy">
            <div className="today-stage-title">{heroTitle}</div>
          </div>

          {/* Record button — the hero action */}
          <div className="today-capture-card">
            <RecordButton />
          </div>

          {/* Living quote */}
          <div className="living-note" key={quoteIndex}>
            <span className="living-note-dot" aria-hidden="true" />
            <span>{LIVING_QUOTES[quoteIndex]}</span>
          </div>
        </div>

        {/* Stats strip */}
        <div className="today-stat-strip">
          {[
            { value: stats.conversations > 0 ? String(stats.conversations) : '—', label: 'Today' },
            { value: (stats.recorded + (recordingStatus.is_recording ? (recordingStatus.duration_seconds ?? 0) : 0)) > 0 ? formatDuration(stats.recorded + (recordingStatus.is_recording ? (recordingStatus.duration_seconds ?? 0) : 0)) : '—', label: 'Recorded' },
            { value: stats.pending > 0 ? String(stats.pending) : '—', label: 'In queue' },
            { value: stats.archive > 0 ? String(stats.archive) : '—', label: 'Total memos' },
          ].map((s, i, arr) => (
            <div key={s.label} style={{ display: 'contents' }}>
              <div className="today-stat-item">
                <span className="today-stat-value">{s.value}</span>
                <span className="today-stat-label">{s.label}</span>
              </div>
              {i < arr.length - 1 && <div className="today-stat-sep" />}
            </div>
          ))}
        </div>
      </section>

      {/* ── Recent recordings ── */}
      <section className="surface-panel">
        <div className="panel-header">
          <div className="section-label">Recent</div>
          <button className="ghost-pill" onClick={() => setActiveView('projects')}>View all</button>
        </div>

        {loading ? (
          <div className="skeleton" style={{ height: 48, borderRadius: 10 }} />
        ) : recentByDay.length === 0 ? (
          <div style={{ padding: '14px 0 4px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            {stats.hasAnyMeetings
              ? 'Nothing recorded today. Previous memos are in the archive.'
              : 'No memos yet. Hit record to capture your first.'}
          </div>
        ) : (
          recentByDay.map(({ date, shown, extra }) => (
            <div key={date} className="today-day-group">
              <div className="today-day-label">{relativeDate(date)}</div>
              {shown.map((meeting) => (
                <div key={meeting.id} className="today-rec-row" onClick={() => openMeeting(meeting.id)}>
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
                  <span className="today-rec-meta">
                    {meeting.start_time ? `${meeting.start_time} · ` : ''}{formatDuration(meeting.duration_seconds)}
                  </span>
                </div>
              ))}
              {extra > 0 && (
                <div className="today-rec-more">+{extra} more</div>
              )}
            </div>
          ))
        )}
      </section>
    </div>
  )
}
