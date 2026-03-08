import { useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { AudioFileStatus, Meeting } from '../../lib/types'
import * as api from '../../lib/tauri'
import { useMemosaStore } from '../../store'

const TRANSCRIBING_QUOTES = [
  'Listening carefully…',
  'Converting sound waves to text.',
  'Whisper is doing its thing.',
  'Good transcriptions take a moment.',
  'Every word counts.',
  'Almost there — probably.',
  'This is the part where we wait.',
  'Patience is a virtue, especially with audio.',
  'Making sense of the noise.',
  'Worth the wait.',
]

function TranscribingState() {
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * TRANSCRIBING_QUOTES.length))
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const cycle = () => {
      setVisible(false)
      setTimeout(() => {
        setQuoteIndex((i) => (i + 1) % TRANSCRIBING_QUOTES.length)
        setVisible(true)
      }, 400)
    }
    const id = setInterval(cycle, 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 32 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)',
            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>Transcribing…</div>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)', maxWidth: 260,
          opacity: visible ? 1 : 0, transition: 'opacity 400ms ease',
        }}>
          {TRANSCRIBING_QUOTES[quoteIndex]}
        </div>
      </div>
    </div>
  )
}

// ─── Waveform ──────────────────────────────────────────────────────
const BAR_BASES = [0.3,0.55,0.8,1,0.75,0.5,0.9,0.65,0.4,0.85,0.7,0.45,1,0.6,0.35,0.8,0.55,0.95,0.7,0.4,0.85,0.5,0.75,1,0.6,0.3,0.9,0.5]

function Waveform({ level }: { level: number }) {
  const amp = Math.max(0.06, level)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 44, padding: '0 2px' }}>
      {BAR_BASES.map((base, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: 2,
          height: Math.max(3, Math.round(base * amp * 44)),
          background: 'var(--accent)',
          opacity: 0.5 + base * 0.5,
          transition: 'height 90ms ease',
        }} />
      ))}
    </div>
  )
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatDateLong(date: string, time: string): string {
  const d = new Date(`${date}T${time}`)
  return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface TranscriptLine {
  timestamp?: string
  text: string
}

type TranscriptViewMode = 'transcript' | 'timeline'
type TranscriptTextMode = 'clean' | 'raw'

function ReviewTabIcon({ kind }: { kind: TranscriptViewMode }) {
  if (kind === 'transcript') {
    return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.5H13V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.35" /><path d="M5.25 5.5H10.75M5.25 8H10.75M5.25 10.5H10.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
  }
  // timeline
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 4.5H12.5M3.5 8H12.5M3.5 11.5H12.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /><circle cx="5" cy="4.5" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="11" cy="11.5" r="1" fill="currentColor" /></svg>
}

// Whisper special tokens: [BLANK_AUDIO], [MUSIC], [NOISE], etc.
const WHISPER_TOKEN_RE = /\[[A-Z_\s]+\]/g

function stripWhisperTokens(text: string): string {
  return text.replace(WHISPER_TOKEN_RE, '').trim()
}

function parseTranscript(raw: string): TranscriptLine[] {
  return raw.split('\n').flatMap((line) => {
    const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+(.+)$/)
    if (match) {
      const text = stripWhisperTokens(match[2])
      return text ? [{ timestamp: match[1], text }] : []
    }
    const trimmed = stripWhisperTokens(line)
    if (trimmed) return [{ text: trimmed }]
    return []
  })
}

function parseTimestampToSeconds(timestamp?: string): number | null {
  if (!timestamp) return null
  const parts = timestamp.split(':').map(Number)
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return null
  return parts[0] * 3600 + parts[1] * 60 + parts[2]
}

function MeetingProjectsRow({ meetingId }: { meetingId: string }) {
  const { folders, meetingFolderAssignments, assignMeetingToProject } = useMemosaStore()
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const assignedIds = meetingFolderAssignments[meetingId] ?? []
  const assignedFolders = assignedIds.map((fid) => folders.find((f) => f.id === fid)).filter(Boolean) as typeof folders
  const unassigned = folders.filter((f) => !assignedIds.includes(f.id))

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  if (folders.length === 0) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      {assignedFolders.map((folder) => (
        <span key={folder.id} className="proj-tv-chip">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: folder.color || 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
          {folder.name}
        </span>
      ))}
      <div ref={pickerRef} style={{ position: 'relative' }}>
        <button className="proj-tv-add-btn" onClick={() => setShowPicker((v) => !v)}>
          {assignedFolders.length === 0 ? '+ Add to project' : '+ project'}
        </button>
        {showPicker && (
          <div className="proj-tv-picker">
            {unassigned.length === 0
              ? <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>All projects assigned</div>
              : unassigned.map((folder) => (
                <button key={folder.id} className="proj-tv-picker-item"
                  onClick={() => { assignMeetingToProject(meetingId, folder.id); setShowPicker(false) }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: folder.color || 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
                  {folder.name}
                </button>
              ))
            }
          </div>
        )}
      </div>
    </div>
  )
}

export function TranscriptViewer({
  meeting,
  onDelete,
  onRetranscribe,
}: {
  meeting: Meeting
  onDelete?: (meeting: Meeting) => void
  onRetranscribe?: (meeting: Meeting) => void
}) {
  const { audioLevel, profiles, recordingStatus, setActiveView, setSearchSeed, transcriptionErrors, availableModels } = useMemosaStore()
  const meetingProfile = profiles.find(p => p.id === meeting.profile_id)
  const profileDefaultViewMode: TranscriptViewMode =
    meetingProfile?.summary_template === 'action_items' || meetingProfile?.summary_template === 'decision_log'
      ? 'timeline'
      : 'transcript'
  const transcriptionFailureError = transcriptionErrors.get(meeting.id)
  const hasDownloadedModel = availableModels.length > 0 && availableModels.some(m => m.downloaded)
  const isThisMeetingRecording = recordingStatus.is_recording && recordingStatus.meeting_id === meeting.id
  const [transcriptContent, setTranscriptContent] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState('')
  const [viewMode, setViewMode] = useState<TranscriptViewMode>(profileDefaultViewMode)
  const [textMode, setTextMode] = useState<TranscriptTextMode>('clean')
  const [editing, setEditing] = useState(false)
  const [loadingTranscript, setLoadingTranscript] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [draftSaved, setDraftSaved] = useState(false)
  const [audioStatus, setAudioStatus] = useState<AudioFileStatus | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(meeting.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioSrc = meeting.audio_path ? convertFileSrc(meeting.audio_path) : null

  useEffect(() => {
    if (!meeting.transcript_path || meeting.transcription_status !== 'complete') {
      setTranscriptContent(null)
      setTranscriptError(null)
      setLoadingTranscript(false)
      return
    }

    let cancelled = false
    setLoadingTranscript(true)
    setTranscriptError(null)

    api.readMeetingTranscript(meeting.id)
      .then((content) => {
        if (cancelled) return
        setTranscriptContent(content)
        setDraftContent(content)
      })
      .catch((error) => {
        if (cancelled) return
        setTranscriptContent(null)
        setDraftContent('')
        setTranscriptError(error instanceof Error ? error.message : 'Transcript file not found.')
      })
      .finally(() => {
        if (!cancelled) setLoadingTranscript(false)
      })

    return () => {
      cancelled = true
    }
  }, [meeting.id, meeting.transcript_path, meeting.transcription_status])

  useEffect(() => {
    if (isThisMeetingRecording) {
      setAudioStatus(null)
      setAudioError(null)
      return
    }

    let cancelled = false
    setAudioStatus(null)
    setAudioError(null)

    api.getMeetingAudioStatus(meeting.id)
      .then((status) => {
        if (!cancelled) setAudioStatus(status)
      })
      .catch((error) => {
        if (!cancelled) setAudioError(error instanceof Error ? error.message : 'Unable to inspect audio file')
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeting.id, meeting.audio_path, isThisMeetingRecording])

  // Sync title draft when meeting changes
  useEffect(() => {
    setTitleDraft(meeting.title)
    setEditingTitle(false)
    setMenuOpen(false)
    setViewMode('transcript')
    setTextMode('clean')
    setTranscriptSearch('')
  }, [meeting.id, meeting.title])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  const handleTitleCommit = () => {
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === meeting.title) {
      setTitleDraft(meeting.title)
      setEditingTitle(false)
      return
    }
    api.renameMeeting(meeting.id, trimmed).catch(() => {
      setTitleDraft(meeting.title)
    })
    setEditingTitle(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTitleCommit()
    if (e.key === 'Escape') { setTitleDraft(meeting.title); setEditingTitle(false) }
  }

  const lines = useMemo(() => parseTranscript(editing ? draftContent : (transcriptContent ?? '')), [draftContent, editing, transcriptContent])
  const cleanTranscript = useMemo(
    () => lines
      .map((line) => line.text.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/, '').trim())
      .join('\n\n'),
    [lines]
  )

  const copyContent = useMemo(() => {
    if (viewMode === 'timeline') {
      return lines.map((l) => l.timestamp ? `[${l.timestamp}] ${l.text}` : l.text).join('\n')
    }
    if (editing) return draftContent
    return textMode === 'clean' ? cleanTranscript : (transcriptContent ?? '')
  }, [viewMode, lines, editing, draftContent, textMode, cleanTranscript, transcriptContent])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyContent)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const handleSaveDraft = () => {
    setSavingDraft(true)
    api.saveMeetingTranscript(meeting.id, draftContent)
      .then(() => {
        setTranscriptContent(draftContent)
        setDraftSaved(true)
        setEditing(false)
        window.setTimeout(() => setDraftSaved(false), 1400)
      })
      .catch((error) => {
        setTranscriptError(error instanceof Error ? error.message : 'Failed to save transcript')
      })
      .finally(() => setSavingDraft(false))
  }

  const seekToTimestamp = (timestamp?: string) => {
    const seconds = parseTimestampToSeconds(timestamp)
    if (seconds == null || !audioRef.current) return
    audioRef.current.currentTime = seconds
    void audioRef.current.play().catch(() => {})
  }

  const openSearchFor = (value: string) => {
    setSearchSeed(value)
    setActiveView('search')
  }

  void openSearchFor // suppress unused warning
  void menuOpen // suppress unused warning

  const copyAvailable = meeting.transcription_status === 'complete' || transcriptContent != null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {editingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={handleTitleCommit}
            onKeyDown={handleTitleKeyDown}
            className="settings-input"
            style={{ fontSize: 18, fontWeight: 650, padding: '2px 8px', width: '100%', marginBottom: 4 }}
          />
        ) : (
          <h2
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
            style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 650, color: 'var(--text-primary)', cursor: 'text', lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >{titleDraft}</h2>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 10px', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)' }}>
            {formatDateLong(meeting.date, meeting.start_time)}
          </p>
          {meetingProfile && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 7px', borderRadius: 100, background: `${meetingProfile.accent}18`, border: `1px solid ${meetingProfile.accent}30`, fontSize: 10, fontWeight: 600, color: meetingProfile.accent, letterSpacing: '0.3px' }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: meetingProfile.accent, display: 'inline-block', flexShrink: 0 }} />
              {meetingProfile.name}
            </span>
          )}
        </div>
        {/* Underline tab bar */}
        <div style={{ display: 'flex' }}>
          {(['transcript', 'timeline'] as TranscriptViewMode[]).map((mode) => (
            <button
              key={mode}
              className={`tv-tab${viewMode === mode ? ' is-active' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              <ReviewTabIcon kind={mode} />
              <span>{mode === 'transcript' ? 'Transcript' : 'Timeline'}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Body (two-column) ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: main scrollable content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Transcript search bar — only shown when transcript is ready */}
        {meeting.transcription_status === 'complete' && transcriptContent && (
          <div style={{ padding: '8px 16px 0', flexShrink: 0, position: 'relative' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              placeholder="Search transcript…"
              value={transcriptSearch}
              onChange={e => setTranscriptSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: 28, paddingRight: transcriptSearch ? 26 : 10, paddingTop: 6, paddingBottom: 6, fontSize: 12, borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
            />
            {transcriptSearch && (
              <button onClick={() => setTranscriptSearch('')} style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
            )}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
          {loadingTranscript ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-4 rounded" style={{ width: `${60 + i * 8}%` }} />)}
            </div>
          ) : (meeting.transcription_status === 'not_started' || meeting.transcription_status === 'failed') && !hasDownloadedModel ? (
            // No model available — show download prompt regardless of status
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 32 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, maxWidth: 280, textAlign: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 3.5L13.5 7H11V13H9V7H6.5L10 3.5Z" fill="var(--accent)" />
                    <rect x="4" y="15" width="12" height="1.5" rx="0.75" fill="var(--accent)" />
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>No model downloaded</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Go to <strong style={{ color: 'var(--text-secondary)' }}>Settings → Models</strong> and download Whisper to transcribe locally.
                  </div>
                </div>
                <button className="ghost-pill is-selected-pill" onClick={() => setActiveView('settings')}>
                  Download a model
                </button>
              </div>
            </div>
          ) : meeting.transcription_status === 'not_started' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 20, padding: 32, textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <circle cx="9" cy="9" r="7.5" stroke="var(--text-muted)" strokeWidth="1.2" />
                  <path d="M9 5.5V9.5L11.5 11" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 240 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {hasDownloadedModel ? 'Ready to transcribe' : 'No model downloaded'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {hasDownloadedModel
                    ? 'Audio is saved locally. Start transcription when ready.'
                    : 'Download a Whisper model in Settings → Models to transcribe this recording.'}
                </div>
              </div>
              {meeting.audio_path && hasDownloadedModel && (
                <button onClick={() => onRetranscribe?.(meeting)} className="ghost-pill is-selected-pill">
                  Transcribe now
                </button>
              )}
              {!hasDownloadedModel && (
                <button onClick={() => setActiveView('settings')} className="ghost-pill">
                  Download a model
                </button>
              )}
            </div>
          ) : meeting.transcription_status === 'processing' ? (
            <TranscribingState />
          ) : meeting.transcription_status === 'failed' ? (
            <div className="empty-panel">
              <div className="empty-title">Transcription failed</div>
              <div className="empty-copy">{transcriptionFailureError ?? 'Something went wrong. Try again.'}</div>
              {onRetranscribe && (
                <button className="ghost-pill" style={{ marginTop: 12 }} onClick={() => onRetranscribe(meeting)}>
                  Try again
                </button>
              )}
            </div>
          ) : editing ? (
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              className="app-select"
              style={{ width: '100%', minHeight: '60vh', resize: 'vertical', lineHeight: 1.65 }}
            />
          ) : transcriptContent ? (
            (() => {
              const sq = transcriptSearch.trim().toLowerCase()
              const filteredLines = sq ? lines.filter(l => l.text.toLowerCase().includes(sq)) : lines
              const displayText = sq
                ? filteredLines.map(l => l.timestamp ? `[${l.timestamp}] ${l.text}` : l.text).join('\n')
                : (textMode === 'clean' ? cleanTranscript : transcriptContent)
              return (
                <div className="space-y-4">
                  {sq && filteredLines.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>No matches for "{transcriptSearch}"</div>
                  ) : viewMode === 'transcript' ? (
                    <div className="surface-panel" style={{ padding: 16 }}>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-body)', fontSize: textMode === 'clean' ? 13 : 12, lineHeight: 1.8, color: textMode === 'clean' ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                        {displayText}
                      </pre>
                    </div>
                  ) : (
                    filteredLines.map((line, i) => (
                      <div key={i} className="flex gap-4 transcript-line-row">
                        {line.timestamp && (
                          <button
                            className="text-xs font-bold flex-shrink-0 pt-0.5 tabular-nums"
                            style={{ color: 'var(--accent)', minWidth: 56, opacity: 0.8 }}
                            onClick={() => seekToTimestamp(line.timestamp)}
                            title="Jump playback to this moment"
                          >
                            [{line.timestamp}]
                          </button>
                        )}
                        <p style={{ color: 'var(--text-primary)', maxWidth: '74ch', margin: 0, fontSize: 13, lineHeight: 1.75 }}>
                          {line.text.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/, '')}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )
            })()
          ) : (
            <div className="empty-panel">
              <div className="empty-title">Transcript unavailable</div>
              <div className="empty-copy">{transcriptError ?? 'Transcript file not found.'}</div>
            </div>
          )}
        </div>
        </div>

        {/* Right: sidebar (collapsible) */}
        {sidebarCollapsed ? (
          <div style={{ width: 36, flexShrink: 0, borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, paddingBottom: 8, gap: 2 }}>
            {/* Expand */}
            <button className="tv-icon-btn" title="Expand sidebar" onClick={() => setSidebarCollapsed(false)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div style={{ height: 1, width: 20, background: 'var(--border)', margin: '4px 0' }} />

            {/* Copy */}
            {copyAvailable && (
              <button className="tv-icon-btn" title={viewMode === 'timeline' ? 'Copy timeline' : 'Copy transcript'} onClick={handleCopy} style={copied ? { color: 'var(--accent)' } : undefined}>
                {copied
                  ? <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="2" width="8.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10 5.5H2V14h8V5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                }
              </button>
            )}

            {/* Export */}
            {meeting.transcription_status === 'complete' && (
              <button className="tv-icon-btn" title="Export TXT" onClick={() => api.saveTextFile(`${meeting.title}.txt`, copyContent)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/></svg>
              </button>
            )}

            {/* Re-transcribe */}
            {meeting.audio_path && (
              <button className="tv-icon-btn" title="Re-transcribe" onClick={() => onRetranscribe?.(meeting)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/><path d="M11 2l2 3-3 1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}
          </div>
        ) : (
          <div className="tv-sidebar" style={{ gap: 10 }}>

            {/* Collapse */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="tv-icon-btn" title="Collapse sidebar" onClick={() => setSidebarCollapsed(true)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* Projects */}
            <MeetingProjectsRow meetingId={meeting.id} />

            <div className="tv-sidebar-divider" />

            {/* Copy — primary action */}
            {copyAvailable && (
              <button className={`tv-sidebar-copy${copied ? ' is-done' : ''}`} onClick={handleCopy}>
                {copied
                  ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><rect x="5.5" y="2" width="8.5" height="10.5" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10 5.5H2V14h8V5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                }
                {copied ? 'Copied!' : viewMode === 'timeline' ? 'Copy timeline' : 'Copy transcript'}
              </button>
            )}

            {/* Format — transcript tab only, not while editing */}
            {transcriptContent && viewMode === 'transcript' && !editing && (
              <div className="tv-sidebar-segment">
                <button className={textMode === 'clean' ? 'is-active' : ''} onClick={() => setTextMode('clean')}>Clean</button>
                <button className={textMode === 'raw' ? 'is-active' : ''} onClick={() => setTextMode('raw')}>Raw</button>
              </div>
            )}

            <div className="tv-sidebar-divider" />

            {/* Action icon row / edit controls */}
            {editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button onClick={handleSaveDraft} disabled={savingDraft} className="tv-sidebar-action-btn" style={{ fontWeight: 600 }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  {savingDraft ? 'Saving…' : draftSaved ? 'Saved' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="tv-sidebar-action-btn">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="tv-sidebar-icon-row">
                {transcriptContent && viewMode === 'transcript' && meeting.transcription_status === 'complete' && (
                  <button className="tv-icon-btn" title="Edit transcript" onClick={() => setEditing(true)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                  </button>
                )}
                {meeting.transcription_status === 'complete' && (
                  <button className="tv-icon-btn" title="Export TXT" onClick={() => api.saveTextFile(`${meeting.title}.txt`, copyContent)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/></svg>
                  </button>
                )}
                {meeting.audio_path && (
                  <button className="tv-icon-btn" title="Re-transcribe" onClick={() => onRetranscribe?.(meeting)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/><path d="M11 2l2 3-3 1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
                {onDelete && (
                  <button className="tv-icon-btn" title="Delete recording" style={{ marginLeft: 'auto', color: 'var(--live)' }} onClick={() => onDelete(meeting)}>
                    <svg width="13" height="13" viewBox="0 0 11 11" fill="none"><path d="M1.5 2.5H9.5M4 2.5V1.5H7V2.5M2.5 2.5L3 9.5H8L8.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                )}
              </div>
            )}

            <div className="tv-sidebar-divider" />

            {/* Recording meta */}
            <div className="tv-sidebar-meta">
              <div>
                {[
                  formatDuration(meeting.duration_seconds),
                  meeting.whisper_model ?? null,
                  audioStatus?.bytes ? `${(audioStatus.bytes / 1024 / 1024).toFixed(1)} MB` : null,
                ].filter(Boolean).join(' · ')}
              </div>
              {meeting.whisper_model && (
                <div style={{ marginTop: 4, opacity: 0.7 }}>Transcribed with Whisper {meeting.whisper_model}</div>
              )}
              {(meeting.attendees?.length ?? 0) > 0 && <div style={{ marginTop: 2 }}>{meeting.attendees.join(', ')}</div>}
            </div>

          </div>
        )}

      </div>

      {/* ── Audio player / status ── */}
      {isThisMeetingRecording ? (
        <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-3 mb-2">
            <span className="live-dot" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--live)', flexShrink: 0, animation: 'pulse 1.4s ease-in-out infinite' }} />
            <span className="text-xs" style={{ color: 'var(--live)', fontWeight: 700 }}>
              Recording live{recordingStatus.duration_seconds != null ? ` · ${Math.floor(recordingStatus.duration_seconds / 60).toString().padStart(2,'0')}:${(recordingStatus.duration_seconds % 60).toString().padStart(2,'0')}` : ''}
            </span>
          </div>
          <Waveform level={audioLevel} />
        </div>
      ) : audioStatus && !audioStatus.exists ? (
        <div className="px-4 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs" style={{ color: 'var(--warning-amber)' }}>Audio file is missing from disk.</div>
        </div>
      ) : audioStatus?.is_empty ? (
        <div className="px-4 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs" style={{ color: 'var(--warning-amber)' }}>Recording file is empty.</div>
        </div>
      ) : audioError ? (
        <div className="px-4 py-2 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs" style={{ color: 'var(--warning-amber)' }}>{audioError}</div>
        </div>
      ) : audioSrc ? (
        <div className="px-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '8px 16px' }}>
          {audioStatus?.is_silent ? (
            <div style={{ fontSize: 11, color: 'var(--warning-amber)', marginBottom: 6 }}>
              Signal appears silent{audioStatus.peak_db != null ? ` (${audioStatus.peak_db.toFixed(1)} dB peak)` : ''}. Check microphone or enable system audio in Settings.
            </div>
          ) : null}
          <audio
            ref={audioRef}
            controls
            src={audioSrc}
            className="w-full"
            style={{ height: 36, accentColor: 'var(--accent)', filter: 'saturate(0.92)', display: 'block' }}
            onError={() => setAudioError('Playback failed to load this recording')}
          />
        </div>
      ) : null}

    </div>
  )
}
