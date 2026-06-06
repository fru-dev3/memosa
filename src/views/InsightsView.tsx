import { useMemo, useState } from 'react'
import { buildAggregateInsight, filterMeetingsByRange, formatDurationCompact, startOfWeek } from '../lib/insights'
import { useMemosaStore } from '../store'

type InsightScope = 'day' | 'week' | 'month' | 'people' | 'topics'

export function InsightsView({ embedded = false }: { embedded?: boolean }) {
  const { meetings, setActiveView, setCurrentMeeting, setSearchSeed } = useMemosaStore()
  const latestMeetingDate = useMemo(() => {
    const sortedDates = meetings.map((m) => m.date).sort()
    return sortedDates[sortedDates.length - 1] ?? new Date().toISOString().slice(0, 10)
  }, [meetings])
  const [scope, setScope] = useState<InsightScope>('day')
  const [anchorDate, setAnchorDate] = useState(latestMeetingDate)

  const anchor = useMemo(() => new Date(`${anchorDate}T12:00:00`), [anchorDate])

  const scopedMeetings = useMemo(() => {
    if (scope === 'day') return meetings.filter((m) => m.date === anchorDate)
    if (scope === 'week') {
      const from = startOfWeek(anchor)
      const to = new Date(from)
      to.setDate(from.getDate() + 6)
      to.setHours(23, 59, 59, 999)
      return filterMeetingsByRange(meetings, from, to)
    }
    if (scope === 'month') {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
      end.setHours(23, 59, 59, 999)
      return filterMeetingsByRange(meetings, start, end)
    }
    return meetings
  }, [anchor, anchorDate, meetings, scope])

  const scopeTitle = scope === 'day'
    ? `${new Date(`${anchorDate}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`
    : scope === 'week'
      ? `Week of ${new Date(`${anchorDate}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' })}`
      : scope === 'month'
        ? new Date(`${anchorDate}T12:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' })
        : 'All notes'

  const overview = useMemo(
    () => buildAggregateInsight(scopeTitle, scopedMeetings),
    [scopeTitle, scopedMeetings]
  )

  const peopleCards = useMemo(() => {
    const map = new Map<string, typeof meetings>()
    for (const m of meetings) {
      for (const person of m.people ?? []) {
        const key = person.trim()
        if (!key) continue
        const bucket = map.get(key) ?? []
        bucket.push(m)
        map.set(key, bucket)
      }
    }
    return Array.from(map.entries())
      .map(([name, items]) => buildAggregateInsight(name, items))
      .filter(Boolean)
      .sort((a, b) => (b?.meetingCount ?? 0) - (a?.meetingCount ?? 0))
      .slice(0, 8)
  }, [meetings])

  const topicCards = useMemo(() => {
    const map = new Map<string, typeof meetings>()
    for (const m of meetings) {
      for (const theme of [...(m.themes ?? []), ...(m.tags ?? [])]) {
        const key = theme.trim()
        if (!key) continue
        const bucket = map.get(key) ?? []
        bucket.push(m)
        map.set(key, bucket)
      }
    }
    return Array.from(map.entries())
      .map(([name, items]) => buildAggregateInsight(name, items))
      .filter(Boolean)
      .sort((a, b) => (b?.meetingCount ?? 0) - (a?.meetingCount ?? 0))
      .slice(0, 8)
  }, [meetings])

  const cards = scope === 'people' ? peopleCards : scope === 'topics' ? topicCards : []
  const overviewCards = scopedMeetings
    .slice(0, 8)
    .map((m) => buildAggregateInsight(m.title, [m]))
    .filter(Boolean)
  const archiveFallbackCards = meetings
    .slice(0, 8)
    .map((m) => buildAggregateInsight(m.title, [m]))
    .filter(Boolean)
  const activeCards = scope === 'people' || scope === 'topics'
    ? cards
    : overviewCards.length > 0 ? overviewCards : archiveFallbackCards
  const fallbackOverview = useMemo(
    () => buildAggregateInsight('Across your archive', meetings),
    [meetings]
  )
  const shouldShowFallbackArchive = meetings.length > 0 && scopedMeetings.length === 0
    && scope !== 'people' && scope !== 'topics'
  const displayOverview = (shouldShowFallbackArchive ? fallbackOverview : overview)!

  const openMeeting = (meetingId: string) => {
    const target = meetings.find((m) => m.id === meetingId)
    if (!target) return
    setCurrentMeeting(target)
    setActiveView('library')
  }

  const searchFor = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  const isTimeScope = scope === 'day' || scope === 'week' || scope === 'month'

  const content = (
    <>
      {/* ── Page title ────────────────────────────────────────── */}
      {!embedded && (
        <div className="insights-title-row">
          <div>
            <div className="eyebrow">Insights</div>
            <h1 className="page-title">The patterns in your notes.</h1>
          </div>
        </div>
      )}

      {/* ── Scope bar ─────────────────────────────────────────── */}
      <div className="insights-scope-bar">
        <div className="insights-scope-group">
          {(['day', 'week', 'month'] as const).map((item) => (
            <button
              key={item}
              className={`insights-scope-btn ${scope === item ? 'is-active' : ''}`}
              onClick={() => setScope(item)}
            >
              {item === 'day' ? 'Daily' : item === 'week' ? 'Weekly' : 'Monthly'}
            </button>
          ))}
        </div>

        <div className="insights-scope-sep" aria-hidden="true" />

        <div className="insights-scope-group">
          {(['people', 'topics'] as const).map((item) => (
            <button
              key={item}
              className={`insights-scope-btn ${scope === item ? 'is-active' : ''}`}
              onClick={() => setScope(item)}
            >
              {item === 'people' ? 'People' : 'Topics'}
            </button>
          ))}
        </div>

        {isTimeScope && (
          <div className="insights-scope-date">
            <span className="insights-date-label">
              {scope === 'day' ? 'Day' : scope === 'week' ? 'Week of' : 'Month'}
            </span>
            <input
              type="date"
              className="app-select insights-date-input"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              max={latestMeetingDate}
            />
          </div>
        )}
      </div>

      {/* ── Overview hero ─────────────────────────────────────── */}
      {(overview || fallbackOverview) && !['people', 'topics'].includes(scope) ? (
        <section className="surface-panel insights-hero-panel">
          <div className="insights-hero-top">
            <div>
              <div className="section-label">
                {shouldShowFallbackArchive ? 'Archive overview' : 'Overview'}
              </div>
              <div className="insights-hero-title">{displayOverview.title}</div>
            </div>
            <div className="insights-hero-stats">
              <div className="insights-hero-stat">
                <span className="insights-hero-stat-val">{displayOverview.meetingCount}</span>
                <span className="insights-hero-stat-label">meetings</span>
              </div>
              <div className="insights-hero-stat">
                <span className="insights-hero-stat-val">
                  {formatDurationCompact(displayOverview.totalDurationSeconds)}
                </span>
                <span className="insights-hero-stat-label">recorded</span>
              </div>
            </div>
          </div>
          <p className="insights-hero-copy">{displayOverview.summary}</p>
          {shouldShowFallbackArchive && (
            <p className="insights-hero-copy" style={{ marginTop: -4, color: 'var(--text-muted)', fontSize: 11 }}>
              No notes in this {scope} — showing archive-wide patterns instead.
            </p>
          )}
          {(displayOverview.people.length > 0 || displayOverview.themes.length > 0) && (
            <div className="insights-chip-row">
              {displayOverview.people.slice(0, 4).map((p) => (
                <button key={p} className="chip chip-muted" onClick={() => searchFor(p)}>{p}</button>
              ))}
              {displayOverview.themes.slice(0, 4).map((t) => (
                <button key={t} className="chip chip-success" onClick={() => searchFor(t)}>{t}</button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* ── Cards / empty states ──────────────────────────────── */}
      {meetings.length === 0 ? (
        <section className="surface-panel insights-empty-panel">
          <div className="insights-empty-copy">
            <div className="section-label">No notes yet</div>
            <div className="insights-summary-title">Insights build as you record.</div>
            <p className="insights-summary-copy">
              Once Memosa has recordings and transcripts, this page turns them into
              daily, weekly, people, and topic summaries.
            </p>
          </div>
          <div className="insights-empty-visual" aria-hidden="true">
            <span className="insights-empty-ring insights-empty-ring-a" />
            <span className="insights-empty-ring insights-empty-ring-b" />
            <span className="insights-empty-core" />
            <span className="insights-empty-dot insights-empty-dot-a" />
            <span className="insights-empty-dot insights-empty-dot-b" />
          </div>
        </section>
      ) : activeCards.length === 0 ? (
        <section className="surface-panel insights-empty-panel">
          <div className="insights-empty-copy">
            <div className="section-label">Nothing in this view yet</div>
            <div className="insights-summary-title">
              {scope === 'day' ? 'No notes for this day.'
                : scope === 'week' ? 'No notes for this week.'
                : scope === 'month' ? 'No notes for this month.'
                : scope === 'people' ? 'No people detected yet.'
                : 'No topic patterns yet.'}
            </div>
            <p className="insights-summary-copy">
              Try a different scope, or keep recording so Memosa has more to work with.
            </p>
          </div>
          <div className="insights-empty-visual is-quiet" aria-hidden="true">
            <span className="insights-empty-ring insights-empty-ring-a" />
            <span className="insights-empty-ring insights-empty-ring-b" />
            <span className="insights-empty-core" />
          </div>
        </section>
      ) : (
        <section className="insights-grid">
          {activeCards.map((card) => (
            <article key={card!.title} className="surface-panel insights-card">
              <div className="insights-card-title-row">
                <div>
                  <div className="insights-card-title">{card!.title}</div>
                  <div className="insights-card-meta">
                    {card!.meetingCount} {card!.meetingCount === 1 ? 'meeting' : 'meetings'}
                    {' · '}
                    {formatDurationCompact(card!.totalDurationSeconds)}
                  </div>
                </div>
              </div>
              <p className="insights-card-copy">{card!.summary}</p>
              {(card!.people.length > 0 || card!.themes.length > 0) && (
                <div className="insights-chip-row">
                  {card!.people.slice(0, 3).map((p) => (
                    <button key={p} className="chip chip-muted" onClick={() => searchFor(p)}>{p}</button>
                  ))}
                  {card!.themes.slice(0, 3).map((t) => (
                    <button key={t} className="chip chip-success" onClick={() => searchFor(t)}>{t}</button>
                  ))}
                </div>
              )}
              <div className="insights-meeting-links">
                {card!.meetings.slice(0, 3).map((m) => (
                  <button key={m.id} className="ghost-pill" onClick={() => openMeeting(m.id)}>
                    {m.title}
                  </button>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  )

  if (embedded) return content
  return <div className="page-shell">{content}</div>
}
