import { useEffect, useMemo, useState } from 'react'
import { useMemosaStore } from '../store'
import { useMeetings } from '../hooks/useMeetings'
import { useTranscription } from '../hooks/useTranscription'
import { LiveMeetingView } from '../components/library/LiveMeetingView'
import { MeetingEntry } from '../components/library/MeetingEntry'
import { TranscriptViewer } from '../components/library/TranscriptViewer'
import { Waveform } from '../components/recording/Waveform'
import type { Meeting, MeetingFilter, WhisperModel } from '../lib/types'

// ─── Grouping ─────────────────────────────────────────────────────

interface MonthGroup { key: string; label: string; meetings: Meeting[] }
interface DayGroup { key: string; label: string; meetings: Meeting[] }

function groupByDay(meetings: Meeting[]): DayGroup[] {
  const map = new Map<string, Meeting[]>()
  for (const m of meetings) {
    if (!map.has(m.date)) map.set(m.date, [])
    map.get(m.date)!.push(m)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const d = new Date(`${key}T12:00:00`)
      const label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      return { key, label, meetings: items }
    })
}

function groupByMonth(meetings: Meeting[]): MonthGroup[] {
  const map = new Map<string, Meeting[]>()
  for (const m of meetings) {
    const key = m.date.slice(0, 7)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(m)
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const [year, month] = key.split('-')
      const label = new Date(Number(year), Number(month) - 1, 1)
        .toLocaleDateString([], { month: 'long', year: 'numeric' })
      return { key, label, meetings: items }
    })
}

function SkeletonRow() {
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="skeleton" style={{ width: '70%', height: 13, marginBottom: 6 }} />
      <div className="skeleton" style={{ width: '45%', height: 11 }} />
    </div>
  )
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 24 }}>
      <div aria-label={message} style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--border-strong)', opacity: 0.7 }} />
    </div>
  )
}

// ─── LibraryView ──────────────────────────────────────────────────

export function LibraryView() {
  const {
    currentMeeting, profiles, recordingStatus, selectedProfileId,
    toggleFavorite, meetings: storeMeetings, setCurrentMeeting,
  } = useMemosaStore()

  const [filterByProfile, setFilterByProfile] = useState(false)
  const activeProfile = profiles.find(p => p.id === selectedProfileId) ?? profiles[0]
  const filter = useMemo<MeetingFilter>(
    () => filterByProfile && activeProfile ? { profile_id: activeProfile.id } : {},
    [filterByProfile, activeProfile?.id]
  )
  const { loading, error, deleteMeeting, openFolder } = useMeetings(filter)
  const { progressMap, startTranscription } = useTranscription()

  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null)
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectMode, setSelectMode] = useState(false)
  const [showMonthRail, setShowMonthRail] = useState(true)
  const [showMeetingList, setShowMeetingList] = useState(true)

  const meetings = storeMeetings
  const monthGroups = useMemo(() => groupByMonth(meetings), [meetings])
  const activeMonthKey = selectedMonthKey ?? monthGroups[0]?.key ?? null
  const activeMeetings = monthGroups.find(g => g.key === activeMonthKey)?.meetings ?? []
  const dayGroups = useMemo(() => groupByDay(activeMeetings), [activeMeetings])

  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set())

  // When the active month changes, expand only the day of the selected meeting (or the first day)
  useEffect(() => {
    const targetDay = selectedMeetingId
      ? activeMeetings.find(m => m.id === selectedMeetingId)?.date
      : dayGroups[0]?.key
    setExpandedDays(targetDay ? new Set([targetDay]) : new Set())
  }, [activeMonthKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDay = (dayKey: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(dayKey)) next.delete(dayKey)
      else next.add(dayKey)
      return next
    })
  }

  // Ensure the day of the selected meeting is expanded when a meeting is selected
  const handleSelectMeetingWithExpand = (meeting: Meeting) => {
    setExpandedDays(prev => {
      if (prev.has(meeting.date)) return prev
      return new Set([...prev, meeting.date])
    })
    handleSelectMeeting(meeting)
  }

  const selectedMeeting = selectedMeetingId
    ? meetings.find(m => m.id === selectedMeetingId) ?? (currentMeeting?.id === selectedMeetingId ? currentMeeting : null)
    : currentMeeting

  useEffect(() => {
    if (!currentMeeting) return
    setSelectedMonthKey(currentMeeting.date.slice(0, 7))
    setSelectedMeetingId(currentMeeting.id)
  }, [currentMeeting])

  useEffect(() => {
    if (loading) return
    if (meetings.length === 0) {
      if (currentMeeting) setCurrentMeeting(null)
      if (selectedMeetingId) setSelectedMeetingId(null)
      setSelectedMonthKey(null)
      return
    }
    const selectedStillVisible = selectedMeetingId ? meetings.some(m => m.id === selectedMeetingId) : false
    if (selectedMeetingId && !selectedStillVisible) {
      const next = meetings[0]
      setSelectedMeetingId(next.id); setSelectedMonthKey(next.date.slice(0, 7)); setCurrentMeeting(next)
      return
    }
    if (!selectedMeetingId && !currentMeeting) {
      const next = meetings[0]
      setSelectedMeetingId(next.id); setSelectedMonthKey(next.date.slice(0, 7)); setCurrentMeeting(next)
    }
  }, [currentMeeting, loading, meetings, selectedMeetingId, setCurrentMeeting])

  const handleRetranscribe = async (meeting: Meeting) => {
    await startTranscription(meeting.audio_path, meeting.id, meeting.whisper_model ?? 'small' as WhisperModel)
  }
  const handleSelectMeeting = (meeting: Meeting) => { setSelectedMeetingId(meeting.id); setCurrentMeeting(meeting) }
  const handleDeleteMeeting = async (id: string) => {
    await deleteMeeting(id)
    if (selectedMeetingId === id) setSelectedMeetingId(null)
    if (currentMeeting?.id === id) setCurrentMeeting(null)
  }
  const handleDeleteSelectedMeeting = async (meeting: Meeting) => {
    if (!window.confirm(`Delete "${meeting.title}"? This will remove the memo, transcript, and saved metadata.`)) return
    await handleDeleteMeeting(meeting.id)
  }
  const toggleSelected = (id: string) =>
    setSelectedIds(cur => cur.includes(id) ? cur.filter(i => i !== id) : [...cur, id])
  const enterSelectMode = () => { setSelectMode(true); setSelectedIds([]) }
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds([]) }
  const selectAllVisible = () => setSelectedIds(activeMeetings.map(m => m.id))
  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    for (const id of ids) await deleteMeeting(id)
    setSelectMode(false); setSelectedIds([])
    if (currentMeeting && ids.includes(currentMeeting.id)) setCurrentMeeting(null)
    if (selectedMeetingId && ids.includes(selectedMeetingId)) setSelectedMeetingId(null)
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ borderRadius: 9, padding: '12px 16px', background: 'var(--live-dim)', border: '1px solid var(--live-border)' }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--live)' }}>Failed to load memos</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <div className="page-header" style={{ padding: '24px 24px 0', marginBottom: 18 }}>
        <div>
          <div className="eyebrow">Memos</div>
          <h1 className="page-title" style={{ fontSize: 28 }}>Every memo in one place.</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {!selectMode && meetings.length > 0 && <button className="ghost-pill" onClick={enterSelectMode}>Select</button>}
          {selectMode && (
            <>
              {selectedIds.length > 0 && <span className="stat-inline">{selectedIds.length} selected</span>}
              <button className="ghost-pill" onClick={selectAllVisible}>Select All</button>
              {selectedIds.length > 0 && (
                <button className="ghost-pill" style={{ color: 'var(--live)', borderColor: 'var(--live-border)' }} onClick={handleBulkDelete}>Delete</button>
              )}
              <button className="ghost-pill" onClick={exitSelectMode}>Cancel</button>
            </>
          )}
          {activeProfile && (
            <button
              className={`ghost-pill ${filterByProfile ? 'is-selected-pill' : ''}`}
              onClick={() => setFilterByProfile(v => !v)}
            >
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 999, background: activeProfile.accent ?? 'var(--accent)', marginRight: 5, verticalAlign: 'middle' }} />
              {filterByProfile ? activeProfile.name : 'All profiles'}
            </button>
          )}
          <span className="stat-inline">{meetings.length} items</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Month rail — collapsed */}
        {!showMonthRail && (
          <button onClick={() => setShowMonthRail(true)} style={{ width: 28, flexShrink: 0, border: 'none', cursor: 'pointer', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14, gap: 8 }}>
            <span style={{ fontSize: 13 }}>›</span>
            <span style={{ writingMode: 'vertical-rl', fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', userSelect: 'none' }}>Months</span>
          </button>
        )}

        {/* Month rail — expanded */}
        {showMonthRail && (
          <div style={{ width: 172, flexShrink: 0, background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '14px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px 8px 0', flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.65px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>By Month</span>
              <button onClick={() => setShowMonthRail(false)} style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, color: 'var(--text-secondary)', fontSize: 13 }}>‹</button>
            </div>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 32, borderRadius: 7 }} />)}
              </div>
            ) : monthGroups.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 0' }}>
                <div style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--border-strong)', opacity: 0.7 }} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {monthGroups.map(group => {
                  const isActive = activeMonthKey === group.key
                  return (
                    <button key={group.key} onClick={() => { setSelectedMonthKey(group.key); setSelectedMeetingId(null); setCurrentMeeting(null) }}
                      style={{ width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 7, border: 'none', background: isActive ? 'var(--bg-selected)' : 'transparent', color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 12, fontWeight: isActive ? 500 : 400, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, position: 'relative', transition: 'background 100ms ease' }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)' }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      {isActive && <span style={{ position: 'absolute', left: 0, top: '25%', bottom: '25%', width: 2, borderRadius: 2, background: 'var(--accent)' }} />}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.label}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{group.meetings.length}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Meeting list — collapsed */}
        {!showMeetingList && (
          <button onClick={() => setShowMeetingList(true)} style={{ width: 28, flexShrink: 0, border: 'none', cursor: 'pointer', background: 'var(--bg-surface)', borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 14, gap: 8 }}>
            <span style={{ fontSize: 13 }}>›</span>
            <span style={{ writingMode: 'vertical-rl', fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--text-muted)', userSelect: 'none' }}>List</span>
          </button>
        )}

        {/* Meeting list */}
        {showMeetingList && (
          <div style={{ width: 252, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '10px 8px 4px', flexShrink: 0 }}>
              <button onClick={() => setShowMeetingList(false)} style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, color: 'var(--text-secondary)', fontSize: 13 }}>‹</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loading ? (
                <><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
              ) : activeMeetings.length === 0 ? (
                <EmptyPanel message={meetings.length === 0 ? 'No memos yet' : 'No memos in this month'} />
              ) : (
                <div>
                  {dayGroups.map(dayGroup => {
                    const isOpen = expandedDays.has(dayGroup.key)
                    const hasSelected = dayGroup.meetings.some(m => m.id === selectedMeetingId)
                    return (
                      <div key={dayGroup.key}>
                        <button
                          onClick={() => toggleDay(dayGroup.key)}
                          className="lib-day-header"
                          style={{ background: hasSelected ? 'var(--bg-selected)' : undefined }}
                        >
                          <span className="lib-day-chevron" style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}>›</span>
                          <span className="lib-day-label">{dayGroup.label}</span>
                          <span className="lib-day-count">{dayGroup.meetings.length}</span>
                        </button>
                        {isOpen && dayGroup.meetings.map(meeting => {
                          const isLiveMeeting = recordingStatus.is_recording && recordingStatus.meeting_id === meeting.id
                          return (
                            <div key={meeting.id} style={{ position: 'relative' }}>
                              {isLiveMeeting && (
                                <div style={{ position: 'absolute', top: 0, bottom: 0, right: 38, zIndex: 1, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
                                  <div style={{ width: 54, height: 24, borderRadius: 5, background: 'var(--live-dim)', border: '1px solid var(--live-border)', overflow: 'hidden', padding: '2px 4px' }}>
                                    <Waveform color="var(--live)" height={18} />
                                  </div>
                                </div>
                              )}
                              <MeetingEntry
                                meeting={meeting}
                                selected={selectedMeetingId === meeting.id}
                                selecting={selectMode}
                                checked={selectedIds.includes(meeting.id)}
                                progress={progressMap.get(meeting.id)?.progress}
                                onClick={() => handleSelectMeetingWithExpand(meeting)}
                                onDelete={handleDeleteMeeting}
                                onOpenFolder={openFolder}
                                onToggleFavorite={toggleFavorite}
                                onToggleChecked={toggleSelected}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Detail panel */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {selectedMeeting && recordingStatus.is_recording && recordingStatus.meeting_id === selectedMeeting.id ? (
            <LiveMeetingView meeting={selectedMeeting} />
          ) : selectedMeeting ? (
            <TranscriptViewer meeting={selectedMeeting} onDelete={handleDeleteSelectedMeeting} onRetranscribe={handleRetranscribe} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, textAlign: 'center', padding: 32 }}>
              <div style={{ width: 10, height: 10, borderRadius: 999, background: 'var(--border-strong)', opacity: 0.8 }} />
              <div style={{ width: 48, height: 1, background: 'var(--border-subtle)' }} />
              <div style={{ width: 48, height: 48, borderRadius: 16, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 18, height: 22, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }} />
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
