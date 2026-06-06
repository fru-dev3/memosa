import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { buildAggregateInsight, formatDurationCompact } from '../lib/insights'
import { useMemosaStore } from '../store'
import { useSearch } from '../hooks/useSearch'
import * as api from '../lib/tauri'
import type { SearchResult, ChatAnswer } from '../lib/types'

const FALLBACK_PROMPTS = ['action items', 'decisions', 'follow-up', 'next steps']

function highlightMatch(text: string, query: string): ReactNode {
  if (!query.trim()) return text
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.split(regex).map((part, index) =>
    index % 2 === 1
      ? <mark key={index} style={{ background: 'rgba(15,190,128,0.12)', color: 'var(--text-primary)', padding: '0 2px', borderRadius: 4 }}>{part}</mark>
      : part
  )
}

function SearchResultCard({ result, query, onClick }: { result: SearchResult; query: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="search-result-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{result.meeting.title}</div>
          <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {result.meeting.source_app && <span className="chip chip-muted">{result.meeting.source_app}</span>}
            {result.timestamp && <span className="chip chip-success">{result.timestamp}</span>}
            {result.meeting.is_favorite && <span className="chip chip-success">starred</span>}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {new Date(`${result.meeting.date}T${result.meeting.start_time}`).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
        {highlightMatch(result.snippet, query)}
      </div>
    </button>
  )
}

export function SearchView({ embedded = false }: { embedded?: boolean }) {
  const {
    meetings,
    searchSeed,
    setActiveView,
    setCurrentMeeting,
    setSearchSeed,
  } = useMemosaStore()
  const { clearSearch, query, setQuery, results, loading, error } = useSearch()
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [showQuerySummary, setShowQuerySummary] = useState(true)
  const [expandedQuerySummary, setExpandedQuerySummary] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [chatAnswer, setChatAnswer] = useState<ChatAnswer | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  const handleAskAI = async () => {
    if (!query.trim()) return
    setChatLoading(true)
    setChatError(null)
    setChatAnswer(null)
    try {
      setChatAnswer(await api.chatWithMeetings(query.trim()))
    } catch (e) {
      setChatError(e instanceof Error ? e.message : 'Could not answer that')
    } finally {
      setChatLoading(false)
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!searchSeed.trim()) return
    setQuery(searchSeed)
    setShowQuerySummary(true)
    setExpandedQuerySummary(false)
    inputRef.current?.focus()
    setSearchSeed('')
  }, [searchSeed, setQuery, setSearchSeed])

  useEffect(() => {
    if (!query.trim()) {
      setShowQuerySummary(true)
      setExpandedQuerySummary(false)
      setChatAnswer(null)
      setChatError(null)
    }
  }, [query])

  const displayResults = useMemo(() => {
    return results.filter((result) => {
      if (favoritesOnly && !result.meeting.is_favorite) return false
      return true
    })
  }, [results, favoritesOnly])

  const aggregate = useMemo(() => {
    if (!query.trim() || displayResults.length === 0) return null
    const meetingsForSummary = Array.from(new Map(displayResults.map((result) => [result.meeting.id, result.meeting])).values())
    return buildAggregateInsight(`About "${query.trim()}"`, meetingsForSummary)
  }, [displayResults, query])
  const aggregateMeetingCount = aggregate?.meetingCount ?? 0

  const suggestedSearches = useMemo(() => {
    const counts = new Map<string, number>()
    for (const meeting of meetings) {
      for (const t of meeting.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
      for (const p of meeting.people ?? []) counts.set(p, (counts.get(p) ?? 0) + 1)
      for (const k of (meeting.keywords ?? []).slice(0, 3)) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term)
    return sorted.length >= 4 ? sorted.slice(0, 6) : FALLBACK_PROMPTS
  }, [meetings])

  const handleResultClick = (result: SearchResult) => {
    const meeting = meetings.find((item) => item.id === result.meeting.id) ?? result.meeting
    setCurrentMeeting(meeting)
    setActiveView('projects')
  }

  const content = (
    <>
      <div className="search-shell">
        <section className="surface-panel search-input-panel">
          <div className="search-panel-eyebrow">
            <div className="eyebrow">Search</div>
          </div>
          <div className="search-input-wrap">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcripts, tags, titles, summaries"
              className="search-input"
            />
            {query && (
              <button
                onClick={() => {
                  clearSearch()
                  setSearchSeed('')
                }}
                className="search-clear"
              >
                Clear
              </button>
            )}
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {suggestedSearches.map((prompt) => (
              <button key={prompt} className="ghost-pill search-prompt-pill" onClick={() => setQuery(prompt)}>{prompt}</button>
            ))}
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className={`ghost-pill ${favoritesOnly ? 'is-selected-pill' : ''}`} onClick={() => setFavoritesOnly((value) => !value)}>
              Starred
            </button>
            {query.trim() && (
              <button className="ghost-pill is-selected-pill" onClick={handleAskAI} disabled={chatLoading}>
                {chatLoading ? 'Thinking…' : '✨ Ask AI'}
              </button>
            )}
            {query.trim() && displayResults.length > 0 ? (
              <button className={`ghost-pill ${showQuerySummary ? 'is-selected-pill' : ''}`} onClick={() => setShowQuerySummary((value) => !value)}>
                {showQuerySummary ? `Summary of ${aggregateMeetingCount} conversations` : `Summarize ${aggregateMeetingCount} conversations`}
              </button>
            ) : null}
          </div>
        </section>

        <section className="surface-panel search-results-panel">
          {(chatLoading || chatAnswer || chatError) && (
            <div style={{
              marginBottom: 16, padding: '14px 16px', borderRadius: 12,
              border: '1px solid var(--accent-border)', background: 'var(--accent-dim)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>✨ AI answer</span>
                {!chatLoading && (
                  <button onClick={() => { setChatAnswer(null); setChatError(null) }} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>×</button>
                )}
              </div>
              {chatLoading ? (
                <div className="skeleton" style={{ height: 48, borderRadius: 8 }} />
              ) : chatError ? (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{chatError}</div>
              ) : chatAnswer ? (
                <>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{chatAnswer.answer}</div>
                  {chatAnswer.sources.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>Sources:</span>
                      {chatAnswer.sources.map((s) => (
                        <button
                          key={s.meeting_id}
                          className="chip chip-muted"
                          onClick={() => {
                            const m = meetings.find((item) => item.id === s.meeting_id)
                            if (m) { setCurrentMeeting(m); setActiveView('projects') }
                          }}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}
          {!query.trim() ? (
            <div style={{ padding: '24px 0 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                {meetings.length > 0 ? `${meetings.length} recording${meetings.length === 1 ? '' : 's'} in your archive` : 'No recordings yet — start a capture to build your archive.'}
              </div>
            </div>
          ) : loading ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="skeleton" style={{ height: 96, borderRadius: 16 }} />
              <div className="skeleton" style={{ height: 96, borderRadius: 16 }} />
            </div>
          ) : error ? (
            <div className="empty-panel">
              <div className="empty-title">Search failed</div>
              <div className="empty-copy">{error}</div>
            </div>
          ) : displayResults.length === 0 ? (
            <div style={{ padding: '24px 0 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>No matches for "{query.trim()}"</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Try a shorter term, a different keyword, or one of your recent topics above.
              </div>
            </div>
          ) : aggregate && showQuerySummary ? (
            <div className="search-results-split">
              <div className="search-results-col">
                {displayResults.map((result, index) => (
                  <SearchResultCard key={`${result.meeting.id}-${index}`} result={result} query={query} onClick={() => handleResultClick(result)} />
                ))}
              </div>
              <aside className="search-summary-aside">
                <div className="search-summary-inner">
                  <div className="section-label">Summary</div>
                  <div className="insights-summary-title" style={{ fontSize: 20, marginTop: 6 }}>{aggregate.title}</div>
                  <p className="insights-summary-copy" style={{ marginTop: 8 }}>
                    {expandedQuerySummary ? aggregate.expandedSummary : aggregate.summary}
                  </p>
                  <div className="insights-stat-row" style={{ marginTop: 10 }}>
                    <span className="stat-inline">{aggregate.meetingCount} meetings</span>
                    <span className="stat-inline">{formatDurationCompact(aggregate.totalDurationSeconds)}</span>
                  </div>
                  <div className="insights-chip-row" style={{ marginTop: 8 }}>
                    {aggregate.people.slice(0, 4).map((person) => (
                      <button key={person} className="chip chip-muted" onClick={() => setQuery(person)}>{person}</button>
                    ))}
                    {aggregate.themes.slice(0, 4).map((theme) => (
                      <button key={theme} className="chip chip-success" onClick={() => setQuery(theme)}>{theme}</button>
                    ))}
                  </div>
                  <button className="ghost-pill" style={{ marginTop: 10 }} onClick={() => setExpandedQuerySummary((value) => !value)}>
                    {expandedQuerySummary ? 'Show less' : 'Expand summary'}
                  </button>
                </div>
              </aside>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {displayResults.map((result, index) => (
                <SearchResultCard key={`${result.meeting.id}-${index}`} result={result} query={query} onClick={() => handleResultClick(result)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )

  if (embedded) return content

  return (
    <div className="page-shell">
      {content}
    </div>
  )
}
