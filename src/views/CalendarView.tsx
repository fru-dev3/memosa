import { useEffect, useMemo, useState } from 'react'
import * as api from '../lib/tauri'
import { useMemosaStore } from '../store'

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.round((totalSeconds % 3600) / 60)
  if (totalSeconds <= 0) return '0m'
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  const day = next.getDay()
  const diff = day === 0 ? -6 : 1 - day
  next.setDate(next.getDate() + diff)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function buildMonthGrid(cursorDate: Date) {
  const monthStart = startOfMonth(cursorDate)
  const monthEnd = endOfMonth(cursorDate)
  const gridStart = startOfWeek(monthStart)
  const gridEnd = addDays(startOfWeek(monthEnd), 6)
  const days: Date[] = []

  for (let current = new Date(gridStart); current <= gridEnd; current = addDays(current, 1)) {
    days.push(new Date(current))
  }

  return days
}

function buildWeekDays(cursorDate: Date) {
  const weekStart = startOfWeek(cursorDate)
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
}

function MinimalEmptyState({ label }: { label?: string }) {
  return (
    <div className="calendar-minimal-empty">
      <div className="calendar-minimal-orbit" aria-hidden="true" />
      {label ? <div className="calendar-minimal-empty-title">{label}</div> : null}
    </div>
  )
}

function ProfileFilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.25" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.25 13.25c.55-2 2.42-3.25 4.75-3.25s4.2 1.25 4.75 3.25" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function PaneIcon({ kind }: { kind: 'calendar' | 'recordings' }) {
  if (kind === 'calendar') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M1.5 6h13M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.25" width="12" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 5.5H11M5 8H11M5 10.5H8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function CalendarView() {
  const { meetings, profiles, setActiveView, setCurrentMeeting, setSearchSeed, setMeetings } = useMemosaStore()
  const today = new Date()

  useEffect(() => {
    api.getMeetings({}).then(setMeetings).catch(() => {})
  }, [setMeetings])
  const todayKey = dayKey(today)

  const [selectedDate, setSelectedDate] = useState(todayKey)
  const [mode, setMode] = useState<'month' | 'week'>('month')
  const [profileFilter, setProfileFilter] = useState<string>('all')
  const [cursorDate, setCursorDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [showCalendarPane, setShowCalendarPane] = useState(true)
  const [showRecordingPane, setShowRecordingPane] = useState(true)

  const filteredMeetings = useMemo(
    () => meetings.filter((meeting) => profileFilter === 'all' || meeting.profile_id === profileFilter),
    [meetings, profileFilter]
  )

  const grouped = useMemo(() => {
    return filteredMeetings.reduce<Record<string, typeof filteredMeetings>>((acc, meeting) => {
      acc[meeting.date] ??= []
      acc[meeting.date].push(meeting)
      return acc
    }, {})
  }, [filteredMeetings])

  const visibleDays = useMemo(
    () => (mode === 'month' ? buildMonthGrid(cursorDate) : buildWeekDays(cursorDate)),
    [cursorDate, mode]
  )

  const selectedDateObject = useMemo(() => new Date(`${selectedDate}T12:00:00`), [selectedDate])
  const selectedMeetings = grouped[selectedDate] ?? []
  const totalForSelectedDay = selectedMeetings.reduce((sum, meeting) => sum + meeting.duration_seconds, 0)
  const visibleMeetingCount = visibleDays.reduce((sum, day) => sum + (grouped[dayKey(day)]?.length ?? 0), 0)

  const jumpToToday = () => {
    setCursorDate(new Date(today.getFullYear(), today.getMonth(), mode === 'month' ? 1 : today.getDate()))
    setSelectedDate(todayKey)
  }

  const shiftRange = (direction: -1 | 1) => {
    setCursorDate((current) => {
      if (mode === 'month') {
        return addMonths(current, direction)
      }
      return addDays(current, direction * 7)
    })
  }

  const handleSelectDay = (date: Date) => {
    setSelectedDate(dayKey(date))
    if (mode === 'month' && !isSameMonth(date, cursorDate)) {
      setCursorDate(new Date(date.getFullYear(), date.getMonth(), 1))
    }
  }

  const periodLabel = mode === 'month'
    ? cursorDate.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : `${visibleDays[0].toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${visibleDays[6].toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}`

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
      <div className="page-header">
        <div>
          <div className="eyebrow">Calendar</div>
          <h1 className="page-title">Your archive over time.</h1>
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-pane-controls">
            <button
              className={`calendar-pane-toggle ${showCalendarPane ? 'is-active' : ''}`}
              onClick={() => setShowCalendarPane((value) => !value)}
              aria-label={showCalendarPane ? 'Hide calendar pane' : 'Show calendar pane'}
              title={showCalendarPane ? 'Hide calendar' : 'Show calendar'}
            >
              <PaneIcon kind="calendar" />
            </button>
            <button
              className={`calendar-pane-toggle ${showRecordingPane ? 'is-active' : ''}`}
              onClick={() => setShowRecordingPane((value) => !value)}
              aria-label={showRecordingPane ? 'Hide recordings pane' : 'Show recordings pane'}
              title={showRecordingPane ? 'Hide recordings' : 'Show recordings'}
            >
              <PaneIcon kind="recordings" />
            </button>
          </div>
          <div className="segmented-control">
            {(['month', 'week'] as const).map((item) => (
              <button
                key={item}
                className={`segmented-button ${mode === item ? 'is-active' : ''}`}
                onClick={() => {
                  setMode(item)
                  if (item === 'month') {
                    setCursorDate(new Date(selectedDateObject.getFullYear(), selectedDateObject.getMonth(), 1))
                  } else {
                    setCursorDate(selectedDateObject)
                  }
                }}
              >
                {item === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
          <label className="calendar-profile-filter">
            <span className="calendar-profile-filter-icon">
              <ProfileFilterIcon />
            </span>
            <select className="calendar-profile-filter-select" value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
              <option value="all">All profiles</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
            </select>
            <span className="calendar-profile-filter-chevron" aria-hidden="true">⌄</span>
          </label>
        </div>
      </div>

      <div className="calendar-layout">
        {showCalendarPane && (
        <section className="surface-panel">
          <div className="panel-header">
            <div>
              <div className="calendar-period-title">{periodLabel}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="calendar-nav-btn" onClick={() => shiftRange(-1)} aria-label="Previous" title="Previous">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button className="ghost-pill" onClick={jumpToToday}>Today</button>
              <button className="calendar-nav-btn" onClick={() => shiftRange(1)} aria-label="Next" title="Next">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M4.5 2L8.5 6L4.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {visibleMeetingCount > 0 ? <div className="stat-inline">{visibleMeetingCount}</div> : null}
            </div>
          </div>

          <div className="calendar-weekdays">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
              <div key={label} className="calendar-weekday-label">{label}</div>
            ))}
          </div>

          <div className={`calendar-grid ${mode === 'week' ? 'is-week' : ''}`}>
            {visibleDays.map((day) => {
              const key = dayKey(day)
              const dayMeetings = grouped[key] ?? []
              const duration = dayMeetings.reduce((sum, meeting) => sum + meeting.duration_seconds, 0)
              const active = key === selectedDate
              const isToday = key === todayKey
              const outsideMonth = mode === 'month' && !isSameMonth(day, cursorDate)

              return (
                <button
                  key={key}
                  className={`calendar-day-card ${active ? 'is-active' : ''} ${outsideMonth ? 'is-outside-month' : ''}`}
                  onClick={() => handleSelectDay(day)}
                >
                  <span className={`calendar-date-pill ${isToday ? 'is-today' : ''}`}>{day.getDate()}</span>
                  {dayMeetings.length > 0 && (
                    <span className="calendar-day-rec-badge">{dayMeetings.length}</span>
                  )}
                </button>
              )
            })}
          </div>
        </section>
        )}

        {showRecordingPane && (
        <section className="surface-panel">
          <div className="panel-header">
            <div>
              <div className="calendar-period-title">
                {selectedDateObject.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
            {selectedMeetings.length > 0 ? <div className="stat-inline">{formatDuration(totalForSelectedDay)}</div> : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {selectedMeetings.length === 0 ? (
              <MinimalEmptyState label="" />
            ) : (
              selectedMeetings.map((meeting) => {
                const tags = [...(meeting.tags ?? []), ...(meeting.people ?? []), ...(meeting.themes ?? [])].slice(0, 4)
                return (
                  <div
                    key={meeting.id}
                    className="cal-rec-row"
                    onClick={() => openMeeting(meeting.id)}
                  >
                    {/* status icon */}
                    <span className="cal-rec-status">
                      {meeting.transcription_status === 'complete' ? (
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" fill="color-mix(in srgb, #22c55e 15%, transparent)" stroke="#22c55e" strokeWidth="1"/><path d="M3.5 6.5L5.5 8.5L9.5 4.5" stroke="#22c55e" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      ) : meeting.transcription_status === 'failed' ? (
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" fill="color-mix(in srgb, #ef4444 12%, transparent)" stroke="#ef4444" strokeWidth="1"/><path d="M4.5 4.5L8.5 8.5M8.5 4.5L4.5 8.5" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round"/></svg>
                      ) : (
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="6" stroke="var(--border-subtle)" strokeWidth="1"/><circle cx="6.5" cy="6.5" r="2" fill="var(--text-muted)"/></svg>
                      )}
                    </span>
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
              })
            )}
          </div>
        </section>
        )}
      </div>
    </div>
  )
}
