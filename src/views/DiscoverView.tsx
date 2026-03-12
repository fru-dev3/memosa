import { useMemo } from 'react'
import { useMeetings } from '../hooks/useMeetings'
import { buildAggregateInsight, formatDurationCompact } from '../lib/insights'
import { useMemosaStore } from '../store'

export function DiscoverView() {
  const { meetings, setActiveView, setSearchSeed, setCurrentMeeting } = useMemosaStore()
  useMeetings()

  const overview = useMemo(() => buildAggregateInsight('Across your archive', meetings), [meetings])
  const people = useMemo(() => overview?.people.slice(0, 14) ?? [], [overview])
  const themes = useMemo(() => overview?.themes.slice(0, 14) ?? [], [overview])

  const recentMeetings = useMemo(() => {
    return [...meetings]
      .sort((a, b) => `${b.date}${b.start_time}`.localeCompare(`${a.date}${a.start_time}`))
      .slice(0, 6)
  }, [meetings])

  const openPerson = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  const openTheme = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  const openMeeting = (meetingId: string) => {
    const target = meetings.find((m) => m.id === meetingId)
    if (!target) return
    setCurrentMeeting(target)
    setActiveView('library')
  }

  return (
    <div className="page-shell">

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="surface-panel discover-stage">
        <div className="discover-stage-copy">
          <div className="eyebrow">Discover</div>
          <div className="discover-stage-title">See what keeps coming back.</div>
          <p className="discover-stage-text">
            The strongest people, topics, and recurring threads across your archive.
          </p>
        </div>
        <div className="discover-stage-art" aria-hidden="true">
          <span className="discover-orbit discover-orbit-one" />
          <span className="discover-orbit discover-orbit-two" />
          <span className="discover-orbit discover-orbit-three" />
          <span className="discover-spark discover-spark-a" />
          <span className="discover-spark discover-spark-b" />
          <span className="discover-spark discover-spark-c" />
        </div>
      </section>

      {overview ? (
        <>
          {/* ── Stats strip ───────────────────────────────────── */}
          <div className="discover-stats-strip">
            <div className="discover-stat-block">
              <span className="discover-stat-val">{overview.meetingCount}</span>
              <span className="discover-stat-label">recordings</span>
            </div>
            <div className="discover-stat-block">
              <span className="discover-stat-val">{formatDurationCompact(overview.totalDurationSeconds)}</span>
              <span className="discover-stat-label">total recorded</span>
            </div>
            <div className="discover-stat-block">
              <span className="discover-stat-val">{people.length}</span>
              <span className="discover-stat-label">people</span>
            </div>
            <div className="discover-stat-block">
              <span className="discover-stat-val">{themes.length}</span>
              <span className="discover-stat-label">themes</span>
            </div>
          </div>

          {/* ── Clusters ──────────────────────────────────────── */}
          <div className="discover-clusters">

            {/* People */}
            <article className="discover-cluster-card discover-cluster-people">
              <div className="discover-cluster-eyebrow">People</div>
              <div className="discover-cluster-count">{people.length}</div>
              <div className="discover-cluster-label">
                {people.length === 1 ? 'person in your archive' : 'people across your archive'}
              </div>
              {people.length > 0 ? (
                <div className="discover-chip-cloud">
                  {people.map((person) => (
                    <button
                      key={person}
                      className="discover-chip discover-chip-people"
                      onClick={() => openPerson(person)}
                    >
                      {person}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="discover-cluster-empty">
                  Names surface from transcripts as you record.
                </p>
              )}
            </article>

            {/* Topics */}
            <article className="discover-cluster-card discover-cluster-topics">
              <div className="discover-cluster-eyebrow">Topics</div>
              <div className="discover-cluster-count">{themes.length}</div>
              <div className="discover-cluster-label">
                {themes.length === 1 ? 'recurring theme' : 'recurring themes detected'}
              </div>
              {themes.length > 0 ? (
                <div className="discover-chip-cloud">
                  {themes.map((theme) => (
                    <button
                      key={theme}
                      className="discover-chip discover-chip-topics"
                      onClick={() => openTheme(theme)}
                    >
                      {theme}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="discover-cluster-empty">
                  Recurring topics emerge once you have a few recordings.
                </p>
              )}
            </article>

          </div>

          {/* ── Narrative ─────────────────────────────────────── */}
          <section className="surface-panel discover-narrative-panel">
            <div className="discover-narrative-inner">
              <div className="discover-narrative-main">
                <div className="section-label">Archive narrative</div>
                <div className="discover-narrative-title">The full picture</div>
                <p className="discover-narrative-text">{overview.expandedSummary}</p>
                {overview.tags.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div className="discover-narrative-signal-label">Signal words</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 10 }}>
                      {overview.tags.slice(0, 10).map((tag) => (
                        <button key={tag} className="chip chip-muted" onClick={() => openTheme(tag)}>{tag}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <aside className="discover-narrative-aside">
                <div className="discover-narrative-quote-block">
                  <div className="discover-narrative-quote-mark">"</div>
                  <p className="discover-narrative-quote-text">{overview.summary}</p>
                </div>
                <div className="discover-narrative-aside-stats">
                  <div className="discover-narrative-aside-stat">
                    <span className="discover-narrative-aside-val">{overview.meetingCount}</span>
                    <span className="discover-narrative-aside-label">meetings</span>
                  </div>
                  <div className="discover-narrative-aside-stat">
                    <span className="discover-narrative-aside-val">{formatDurationCompact(overview.totalDurationSeconds)}</span>
                    <span className="discover-narrative-aside-label">recorded</span>
                  </div>
                  <div className="discover-narrative-aside-stat">
                    <span className="discover-narrative-aside-val">{people.length}</span>
                    <span className="discover-narrative-aside-label">people</span>
                  </div>
                </div>
                {(overview.people.length > 0 || overview.themes.length > 0) && (
                  <div style={{ marginTop: 16 }}>
                    <div className="discover-narrative-signal-label" style={{ marginBottom: 8 }}>Top mentions</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {overview.people.slice(0, 3).map((p) => (
                        <button key={p} className="chip chip-muted" onClick={() => openPerson(p)}>{p}</button>
                      ))}
                      {overview.themes.slice(0, 3).map((t) => (
                        <button key={t} className="chip chip-success" onClick={() => openTheme(t)}>{t}</button>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </section>

          {/* ── Recent recordings ─────────────────────────────── */}
          {recentMeetings.length > 0 && (
            <section>
              <div className="discover-recordings-hdr">
                <div className="section-label">Recent recordings</div>
                <div className="discover-recordings-title">Latest from your archive</div>
              </div>
              <div className="discover-recordings-grid">
                {recentMeetings.map((meeting) => (
                  <article
                    key={meeting.id}
                    className="surface-panel discover-recording-card"
                    onClick={() => openMeeting(meeting.id)}
                  >
                    <div className="discover-recording-date">
                      {new Date(`${meeting.date}T${meeting.start_time}`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      <span style={{ marginLeft: 8, opacity: 0.4 }}>·</span>
                      <span style={{ marginLeft: 8 }}>
                        {Math.floor(meeting.duration_seconds / 60) > 0
                          ? `${Math.floor(meeting.duration_seconds / 60)}m`
                          : `${meeting.duration_seconds}s`}
                      </span>
                    </div>
                    <div className="discover-recording-title">{meeting.title}</div>
                    {meeting.summary && (
                      <p className="discover-recording-summary">{meeting.summary}</p>
                    )}
                    {((meeting.people?.length ?? 0) > 0 || (meeting.themes?.length ?? 0) > 0) && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        {(meeting.people ?? []).slice(0, 2).map((p) => (
                          <button key={p} className="chip chip-muted" onClick={(e) => { e.stopPropagation(); openPerson(p) }}>{p}</button>
                        ))}
                        {(meeting.themes ?? []).slice(0, 2).map((t) => (
                          <button key={t} className="chip chip-success" onClick={(e) => { e.stopPropagation(); openTheme(t) }}>{t}</button>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="surface-panel insights-empty-panel">
          <div className="insights-empty-copy">
            <div className="section-label">No notes yet</div>
            <div className="insights-summary-title">Discover fills in as you record.</div>
            <p className="insights-summary-copy">
              Once Memosa has recordings and transcripts, this page surfaces
              the people and topics that keep showing up.
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
      )}
    </div>
  )
}
