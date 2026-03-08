import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

// ─── Date helpers ─────────────────────────────────────────────────────────────

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function startOfWeek(date: Date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function addMonths(date: Date, n: number) {
  return new Date(date.getFullYear(), date.getMonth() + n, 1)
}

function buildMonthGrid(cursor: Date) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
  const gridStart = startOfWeek(monthStart)
  const gridEnd = addDays(startOfWeek(monthEnd), 6)
  const days: Date[] = []
  for (let d = new Date(gridStart); d <= gridEnd; d = addDays(d, 1)) days.push(new Date(d))
  return days
}

function buildWeekDays(cursor: Date) {
  const ws = startOfWeek(cursor)
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i))
}

function formatDuration(secs: number) {
  if (secs <= 0) return '0m'
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return h === 0 ? `${m}m` : `${h}h ${m}m`
}

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  if (status === 'complete') return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6.5" cy="6.5" r="6" fill="color-mix(in srgb,#22c55e 15%,transparent)" stroke="#22c55e" strokeWidth="1"/>
      <path d="M3.5 6.5L5.5 8.5L9.5 4.5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
  if (status === 'failed') return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6.5" cy="6.5" r="6" fill="color-mix(in srgb,#ef4444 12%,transparent)" stroke="#ef4444" strokeWidth="1"/>
      <path d="M4.5 4.5L8.5 8.5M8.5 4.5L4.5 8.5" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="6.5" cy="6.5" r="6" stroke="var(--border-subtle)" strokeWidth="1"/>
      <circle cx="6.5" cy="6.5" r="2" fill="var(--text-muted)"/>
    </svg>
  )
}

// ─── Profile filter ───────────────────────────────────────────────────────────

function ProfileFilterIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.25 13.25c.55-2 2.42-3.25 4.75-3.25s4.2 1.25 4.75 3.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CalendarView() {
  const { meetings, profiles, setActiveView, setCurrentMeeting, setSearchSeed, setMeetings } = useMemosaStore()
  const today = new Date()
  const todayKey = dayKey(today)

  useEffect(() => {
    api.getMeetings({}).then(setMeetings).catch(() => {})
  }, [setMeetings])

  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [profileFilter, setProfileFilter] = useState('all')
  const [cursorDate, setCursorDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))

  const filteredMeetings = useMemo(
    () => meetings.filter((m) => profileFilter === 'all' || m.profile_id === profileFilter),
    [meetings, profileFilter]
  )

  const grouped = useMemo(() =>
    filteredMeetings.reduce<Record<string, typeof filteredMeetings>>((acc, m) => {
      acc[m.date] ??= []
      acc[m.date].push(m)
      return acc
    }, {}),
    [filteredMeetings]
  )

  const visibleDays = useMemo(
    () => mode === 'month' ? buildMonthGrid(cursorDate) : buildWeekDays(cursorDate),
    [cursorDate, mode]
  )

  const selectedDateObj = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate])
  const selectedMeetings = grouped[selectedDate] ?? []
  const totalDuration = selectedMeetings.reduce((s, m) => s + m.duration_seconds, 0)

  const periodLabel = mode === 'month'
    ? cursorDate.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : `${visibleDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${visibleDays[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`

  const shiftRange = (dir: -1 | 1) => {
    setCursorDate((cur) => mode === 'month' ? addMonths(cur, dir) : addDays(cur, dir * 7))
  }

  const jumpToToday = () => {
    setCursorDate(new Date(today.getFullYear(), today.getMonth(), 1))
    setSelectedDate(todayKey)
  }

  const handleSelectDay = (date: Date) => {
    setSelectedDate(dayKey(date))
    if (mode === 'month' && !isSameMonth(date, cursorDate)) {
      setCursorDate(new Date(date.getFullYear(), date.getMonth(), 1))
    }
  }

  const openMeeting = (id: string) => {
    const target = meetings.find((m) => m.id === id)
    if (!target) return
    setCurrentMeeting(target)
    setActiveView('projects')
  }

  const openSearchFor = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  // max recordings on any day in view — for density bar sizing
  const maxCount = useMemo(
    () => Math.max(1, ...visibleDays.map((d) => grouped[dayKey(d)]?.length ?? 0)),
    [visibleDays, grouped]
  )

  return (
    <div className="page-shell">
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <div className="eyebrow">Calendar</div>
          <h1 className="page-title">Your archive over time.</h1>
        </div>
        <div className="calendar-toolbar">
          {/* Month / Week toggle */}
          <div className="segmented-control">
            {(['month', 'week'] as const).map((m) => (
              <button
                key={m}
                className={`segmented-button ${mode === m ? 'is-active' : ''}`}
                onClick={() => {
                  setMode(m)
                  if (m === 'month') setCursorDate(new Date(selectedDateObj.getFullYear(), selectedDateObj.getMonth(), 1))
                  else setCursorDate(selectedDateObj)
                }}
              >
                {m === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
          {/* Profile filter */}
          <label className="calendar-profile-filter">
            <span className="calendar-profile-filter-icon"><ProfileFilterIcon /></span>
            <select className="calendar-profile-filter-select" value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
              <option value="all">All profiles</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span className="calendar-profile-filter-chevron" aria-hidden="true">⌄</span>
          </label>
        </div>
      </div>

      {/* ── Calendar nav bar ── */}
      <div className="cal2-nav">
        <button className="calendar-nav-btn" onClick={() => shiftRange(-1)} aria-label="Previous">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="cal2-period">{periodLabel}</span>
        <button className="calendar-nav-btn" onClick={() => shiftRange(1)} aria-label="Next">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button className="ghost-pill" style={{ marginLeft: 6 }} onClick={jumpToToday}>Today</button>
      </div>

      {/* ── MONTH VIEW ── */}
      {mode === 'month' && (
        <div className="cal2-month-wrap">
          {/* Weekday headers */}
          <div className="cal2-weekdays">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="cal2-weekday">{d}</div>
            ))}
          </div>
          {/* Day grid */}
          <div className="cal2-grid">
            {visibleDays.map((day) => {
              const key = dayKey(day)
              const count = grouped[key]?.length ?? 0
              const isSelected = key === selectedDate
              const isToday = key === todayKey
              const outside = !isSameMonth(day, cursorDate)
              return (
                <button
                  key={key}
                  className={`cal2-cell${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${outside ? ' is-outside' : ''}${count > 0 ? ' has-memos' : ''}`}
                  onClick={() => handleSelectDay(day)}
                >
                  <span className="cal2-date-num">{day.getDate()}</span>
                  {count > 0 && (
                    <div className="cal2-density-bar" style={{ width: `${Math.round((count / maxCount) * 100)}%` }} />
                  )}
                  {count > 0 && <span className="cal2-count">{count}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {mode === 'week' && (
        <div className="cal2-week-grid">
          {visibleDays.map((day) => {
            const key = dayKey(day)
            const dayMeetings = grouped[key] ?? []
            const isToday = key === todayKey
            const isSelected = key === selectedDate
            return (
              <div
                key={key}
                className={`cal2-week-col${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`}
                onClick={() => handleSelectDay(day)}
              >
                <div className="cal2-week-col-header">
                  <span className="cal2-week-day-name">{day.toLocaleDateString([], { weekday: 'short' })}</span>
                  <span className={`cal2-week-date-num${isToday ? ' is-today' : ''}`}>{day.getDate()}</span>
                  {dayMeetings.length > 0 && <span className="cal2-week-count">{dayMeetings.length}</span>}
                </div>
                <div className="cal2-week-col-body">
                  {dayMeetings.length === 0 ? (
                    <div className="cal2-week-empty" />
                  ) : (
                    dayMeetings.map((m) => (
                      <button
                        key={m.id}
                        className="cal2-week-memo"
                        onClick={(e) => { e.stopPropagation(); openMeeting(m.id) }}
                        title={m.title || 'Untitled'}
                      >
                        <StatusDot status={m.transcription_status} />
                        <span className="cal2-week-memo-title">{m.title || 'Untitled'}</span>
                        {m.start_time && <span className="cal2-week-memo-time">{m.start_time}</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Selected day panel (month view only) ── */}
      {mode === 'month' && (
        <div className="cal2-day-panel">
          <div className="cal2-day-panel-header">
            <span className="cal2-day-panel-date">
              {selectedDateObj.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </span>
            {selectedMeetings.length > 0 && (
              <span className="cal2-day-panel-meta">
                {selectedMeetings.length} memo{selectedMeetings.length !== 1 ? 's' : ''} · {formatDuration(totalDuration)}
              </span>
            )}
          </div>

          {selectedMeetings.length === 0 ? (
            <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              {selectedDate === todayKey ? 'Nothing captured today yet.' : selectedDate > todayKey ? 'Future date.' : 'No memos on this day.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {selectedMeetings.map((meeting) => {
                const tags = [...(meeting.tags ?? []), ...(meeting.people ?? []), ...(meeting.themes ?? [])].slice(0, 3)
                return (
                  <div key={meeting.id} className="cal-rec-row" onClick={() => openMeeting(meeting.id)}>
                    <span className="cal-rec-status"><StatusDot status={meeting.transcription_status} /></span>
                    <span className="cal-rec-title">{meeting.title || 'Untitled'}</span>
                    {tags.length > 0 && (
                      <span className="cal-rec-tags">
                        {tags.map((tag) => (
                          <button key={tag} className="cal-rec-tag" onClick={(e) => { e.stopPropagation(); openSearchFor(tag) }}>{tag}</button>
                        ))}
                      </span>
                    )}
                    <span className="cal-rec-time">{meeting.start_time}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
