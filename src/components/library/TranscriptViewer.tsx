import { useEffect, useMemo, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import type { AudioFileStatus, Meeting, WhisperModel } from '../../lib/types'
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

type TranscriptViewMode = 'transcript' | 'timeline' | 'notes'
type TranscriptTextMode = 'clean' | 'raw'

function ReviewTabIcon({ kind }: { kind: TranscriptViewMode }) {
  if (kind === 'transcript') {
    return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.5H13V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.35" /><path d="M5.25 5.5H10.75M5.25 8H10.75M5.25 10.5H10.75" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
  }
  if (kind === 'timeline') {
    return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 4.5H12.5M3.5 8H12.5M3.5 11.5H12.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /><circle cx="5" cy="4.5" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="11" cy="11.5" r="1" fill="currentColor" /></svg>
  }
  // notes
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.5H10L13 5.5V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /><path d="M9.5 2.5V6H13" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" /><path d="M5.5 8.5H10.5M5.5 10.5H8.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" /></svg>
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
  const { audioLevel, profiles, recordingStatus, setActiveView, setSearchSeed, transcriptionErrors, availableModels, upsertMeeting } = useMemosaStore()
  const downloadedModels = availableModels.filter(m => m.downloaded)
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
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [confirmingRetranscribe, setConfirmingRetranscribe] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [labelingSpeakers, setLabelingSpeakers] = useState(false)
  const [speakerTranscript, setSpeakerTranscript] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const transcriptSearchRef = useRef<HTMLInputElement>(null)
  const [notesContent, setNotesContent] = useState('')
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const notesTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)
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

  // Load notes when meeting changes
  useEffect(() => {
    let cancelled = false
    setNotesContent('')
    api.readMeetingNotes(meeting.id).then((content) => {
      if (!cancelled) setNotesContent(content)
    }).catch(() => {
      if (!cancelled) setNotesContent('')
    })
    return () => { cancelled = true }
  }, [meeting.id])

  // Sync title draft when meeting changes
  useEffect(() => {
    setTitleDraft(meeting.title)
    setEditingTitle(false)
    setMenuOpen(false)
    setConfirmingDelete(false)
    setConfirmingRetranscribe(false)
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

  const handleNotesChange = (value: string) => {
    setNotesContent(value)
    setNotesState('saving')
    if (notesTimeout.current) clearTimeout(notesTimeout.current)
    notesTimeout.current = setTimeout(() => {
      void api.saveMeetingNotes(meeting.id, value).then(() => {
        setNotesState('saved')
        setTimeout(() => setNotesState('idle'), 1600)
      }).catch(() => setNotesState('idle'))
    }, 450)
  }

  useEffect(() => {
    if (!showModelPicker) return
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node))
        setShowModelPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelPicker])

  // ⌘F focuses transcript search input when transcript is visible
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')
          && viewMode !== 'notes' && meeting.transcription_status === 'complete' && transcriptContent) {
        e.preventDefault()
        transcriptSearchRef.current?.focus()
        transcriptSearchRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [viewMode, meeting.transcription_status, transcriptContent])

  const handleRegenerateInsights = async () => {
    setRegenerating(true)
    try {
      const updated = await api.regenerateInsights(meeting.id)
      upsertMeeting(updated)
      window.dispatchEvent(new CustomEvent('memosa:toast', { detail: { message: 'Summary & insights regenerated' } }))
    } catch (e) {
      window.dispatchEvent(new CustomEvent('memosa:toast', {
        detail: { message: e instanceof Error ? e.message : 'Could not regenerate insights' },
      }))
    } finally {
      setRegenerating(false)
    }
  }

  const handleLabelSpeakers = async () => {
    setLabelingSpeakers(true)
    try {
      const labeled = await api.generateSpeakerTranscript(meeting.id)
      setSpeakerTranscript(labeled)
    } catch (e) {
      window.dispatchEvent(new CustomEvent('memosa:toast', {
        detail: { message: e instanceof Error ? e.message : 'Could not label speakers' },
      }))
    } finally {
      setLabelingSpeakers(false)
    }
  }

  const handleSyncObsidian = async () => {
    try {
      await api.syncMeetingToObsidian(meeting.id)
      window.dispatchEvent(new CustomEvent('memosa:toast', { detail: { message: 'Saved to Obsidian vault' } }))
    } catch (e) {
      window.dispatchEvent(new CustomEvent('memosa:toast', {
        detail: { message: e instanceof Error ? e.message : 'Obsidian sync failed' },
      }))
    }
  }

  const handleSyncNotion = async () => {
    try {
      await api.syncMeetingToNotion(meeting.id)
      window.dispatchEvent(new CustomEvent('memosa:toast', { detail: { message: 'Pushed to Notion' } }))
    } catch (e) {
      window.dispatchEvent(new CustomEvent('memosa:toast', {
        detail: { message: e instanceof Error ? e.message : 'Notion sync failed' },
      }))
    }
  }

  const handleRetranscribeClick = () => {
    if (!meeting.audio_path) return
    // Require confirmation if a transcript already exists
    if (transcriptContent && meeting.transcription_status === 'complete') {
      setConfirmingRetranscribe(true)
      return
    }
    if (downloadedModels.length <= 1) {
      onRetranscribe?.(meeting)
    } else {
      setShowModelPicker(v => !v)
    }
  }

  const confirmRetranscribe = () => {
    setConfirmingRetranscribe(false)
    if (downloadedModels.length <= 1) {
      onRetranscribe?.(meeting)
    } else {
      setShowModelPicker(true)
    }
  }

  const handleRetranscribeWithModel = async (model: WhisperModel) => {
    if (!meeting.audio_path) return
    setShowModelPicker(false)
    upsertMeeting({ ...meeting, transcription_status: 'processing' })
    await api.transcribeAudio(meeting.audio_path, meeting.id, model)
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

  const markdownExportContent = useMemo(() => {
    const date = new Date(`${meeting.date}T${meeting.start_time}`)
    const dateStr = date.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return `# ${meeting.title}\n\n**Date:** ${dateStr}\n\n---\n\n${cleanTranscript}`
  }, [meeting.title, meeting.date, meeting.start_time, cleanTranscript])

  const wordCount = useMemo(() => {
    if (!cleanTranscript) return 0
    return cleanTranscript.trim().split(/\s+/).filter(Boolean).length
  }, [cleanTranscript])

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
            style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 650, color: 'var(--text-primary)', cursor: 'text', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
          {(['transcript', 'notes', 'timeline'] as TranscriptViewMode[]).map((mode) => (
            <button
              key={mode}
              className={`tv-tab${viewMode === mode ? ' is-active' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              <ReviewTabIcon kind={mode} />
              <span>{mode === 'transcript' ? 'Transcript' : mode === 'notes' ? 'Notes' : 'Timeline'}</span>
              {mode === 'notes' && notesContent.length > 0 && (
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginLeft: 4, flexShrink: 0 }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body (two-column) ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Left: main scrollable content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Notes panel */}
        {viewMode === 'notes' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '8px 16px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : notesContent.length > 0 ? 'Stored with this recording' : 'Your private notes about this recording'}
              </span>
            </div>
            <textarea
              value={notesContent}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Type your notes here…"
              style={{
                flex: 1, resize: 'none', border: 'none', outline: 'none',
                padding: '14px 16px', fontSize: 13, lineHeight: 1.65,
                background: 'transparent', color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
              }}
            />
          </div>
        )}

        {/* Transcript search bar — only shown when transcript is ready */}
        {viewMode !== 'notes' && meeting.transcription_status === 'complete' && transcriptContent && (
          <div style={{ padding: '8px 16px 0', flexShrink: 0, position: 'relative' }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input
              ref={transcriptSearchRef}
              type="text"
              placeholder="Search transcript… (⌘F)"
              value={transcriptSearch}
              onChange={e => setTranscriptSearch(e.target.value)}
              style={{ width: '100%', paddingLeft: 28, paddingRight: transcriptSearch ? 26 : 10, paddingTop: 6, paddingBottom: 6, fontSize: 12, borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
            />
            {transcriptSearch && (
              <button onClick={() => setTranscriptSearch('')} style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
            )}
          </div>
        )}
        {viewMode !== 'notes' && meeting.transcription_status === 'complete' &&
          (!!meeting.summary || (meeting.action_items?.length ?? 0) > 0 || (meeting.decisions?.length ?? 0) > 0) && (
          <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
            <details open style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '8px 12px', background: 'var(--bg-surface)' }}>
              <summary style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                AI Insights
              </summary>
              {meeting.summary && (
                <p style={{ fontSize: 13, lineHeight: 1.5, margin: '8px 0 0', color: 'var(--text-primary)' }}>{meeting.summary}</p>
              )}
              {(meeting.action_items?.length ?? 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Action items</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    {meeting.action_items!.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
              {(meeting.decisions?.length ?? 0) > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Decisions</div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    {meeting.decisions!.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>Auto-generated — may be inaccurate.</div>
            </details>
          </div>
        )}

        {viewMode !== 'notes' && (
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
                    <div className="surface-panel" style={{ padding: '16px 20px' }}>
                      <pre className={`tv-transcript-body${textMode === 'raw' ? ' is-raw' : ''}`}>
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
        )}
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
            {meeting.transcription_status === 'complete' && (
              <button className="tv-icon-btn" title="Export Markdown" onClick={() => api.saveTextFile(`${meeting.title}.md`, markdownExportContent)}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4 10V6l2 2 2-2v4M11.5 10V8l-1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            )}

            {/* Regenerate insights */}
            {meeting.transcription_status === 'complete' && (
              <button
                className="tv-icon-btn"
                title="Regenerate summary & insights"
                onClick={handleRegenerateInsights}
                disabled={regenerating}
                style={regenerating ? { opacity: 0.5 } : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2.1l1.05 2.6 2.6 1.05-2.6 1.05L8 9.4 6.95 6.8 4.35 5.75 6.95 4.7 8 2.1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <path d="M12.4 9.4l.5 1.25 1.25.5-1.25.5-.5 1.25-.5-1.25-1.25-.5 1.25-.5.5-1.25Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            {/* Label speakers (AI) */}
            {meeting.transcription_status === 'complete' && (
              <button
                className="tv-icon-btn"
                title="Label speakers (AI)"
                onClick={handleLabelSpeakers}
                disabled={labelingSpeakers}
                style={labelingSpeakers ? { opacity: 0.5 } : undefined}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="5.5" cy="6" r="2.2"/>
                  <circle cx="11" cy="5.5" r="1.7"/>
                  <path d="M1.8 13c0-2 1.6-3.3 3.7-3.3S9.2 11 9.2 13"/>
                  <path d="M10 9.8c1.8 0 3.2 1.1 3.2 2.8"/>
                </svg>
              </button>
            )}

            {/* Sync to Obsidian */}
            {meeting.transcription_status === 'complete' && (
              <button className="tv-icon-btn" title="Save to Obsidian vault" onClick={handleSyncObsidian}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M9.2 1.8 4 5.5l-1.5 5.2L6 14.2l4.3-1.1 2.2-4.6-1.6-5.3-1.7-1.4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
                  <path d="M6 14.2l1.4-4.3 3-1.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            {/* Sync to Notion */}
            {meeting.transcription_status === 'complete' && (
              <button className="tv-icon-btn" title="Push to Notion" onClick={handleSyncNotion}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="2" width="11" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M5.5 5.5v5l5-5v5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}

            {/* Re-transcribe */}
            {meeting.audio_path && (
              confirmingRetranscribe ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                  <button className="tv-icon-btn" title="Confirm re-transcribe" onClick={confirmRetranscribe} style={{ fontSize: 10, padding: '2px 5px', color: 'var(--live)', fontWeight: 700 }}>✓</button>
                  <button className="tv-icon-btn" title="Cancel" onClick={() => setConfirmingRetranscribe(false)} style={{ fontSize: 10, padding: '2px 5px' }}>✕</button>
                </div>
              ) : (
                <button className="tv-icon-btn" title="Re-transcribe" onClick={handleRetranscribeClick}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/><path d="M11 2l2 3-3 1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )
            )}

            {/* Show in Finder */}
            <button className="tv-icon-btn" title="Show in Finder" onClick={() => void api.openMeetingFolder(meeting.id)}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 4.5C1.5 3.4 2.4 2.5 3.5 2.5H6l1.5 2H12.5C13.6 4.5 14.5 5.4 14.5 6.5V12C14.5 13.1 13.6 14 12.5 14H3.5C2.4 14 1.5 13.1 1.5 12V4.5Z"/>
                <path d="M8 7.5v3M6.5 9l1.5 1.5L9.5 9"/>
              </svg>
            </button>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {transcriptContent && viewMode === 'transcript' && meeting.transcription_status === 'complete' && (
                  <button className="tv-sidebar-action-btn" onClick={() => setEditing(true)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2-9 9H2.5v-2l9-9z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                    Edit transcript
                  </button>
                )}
                {meeting.transcription_status === 'complete' && (
                  <button className="tv-sidebar-action-btn" onClick={() => api.saveTextFile(`${meeting.title}.txt`, copyContent)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/></svg>
                    Export as TXT
                  </button>
                )}
                {meeting.transcription_status === 'complete' && (
                  <button className="tv-sidebar-action-btn" onClick={() => api.saveTextFile(`${meeting.title}.md`, markdownExportContent)}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4 10V6l2 2 2-2v4M11.5 10V8l-1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Export as Markdown
                  </button>
                )}
                {meeting.audio_path && (
                  <div ref={modelPickerRef} style={{ position: 'relative' }}>
                    {confirmingRetranscribe ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 7px' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>Overwrite transcript?</span>
                        <button className="tv-icon-btn" onClick={confirmRetranscribe} style={{ fontSize: 10, padding: '2px 6px', color: 'var(--live)', fontWeight: 700 }}>Yes</button>
                        <button className="tv-icon-btn" onClick={() => setConfirmingRetranscribe(false)} style={{ fontSize: 10, padding: '2px 6px' }}>No</button>
                      </div>
                    ) : (
                    <>
                    <button className="tv-sidebar-action-btn" onClick={handleRetranscribeClick}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/><path d="M11 2l2 3-3 1" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Re-transcribe{downloadedModels.length > 1 ? '…' : ''}
                    </button>
                    {showModelPicker && downloadedModels.length > 1 && (
                      <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 120, overflow: 'hidden' }}>
                        <div style={{ padding: '6px 10px 4px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>Model</div>
                        {downloadedModels.map(m => (
                          <button key={m.name} onClick={() => void handleRetranscribeWithModel(m.name)} style={{ display: 'block', width: '100%', padding: '7px 10px', background: 'none', border: 'none', textAlign: 'left', fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                            {m.name}
                            {m.name === meeting.whisper_model && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>current</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    </>
                    )}
                  </div>
                )}
                <button className="tv-sidebar-action-btn" onClick={() => void api.openMeetingFolder(meeting.id)}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1.5 4.5C1.5 3.4 2.4 2.5 3.5 2.5H6l1.5 2H12.5C13.6 4.5 14.5 5.4 14.5 6.5V12C14.5 13.1 13.6 14 12.5 14H3.5C2.4 14 1.5 13.1 1.5 12V4.5Z"/>
                    <path d="M8 7.5v3M6.5 9l1.5 1.5L9.5 9" />
                  </svg>
                  Show in Finder
                </button>
                {onDelete && (
                  confirmingDelete ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 7px' }}>
                      <span style={{ fontSize: 11, color: 'var(--live)', flex: 1 }}>Delete recording?</span>
                      <button className="tv-icon-btn" onClick={() => setConfirmingDelete(false)} style={{ fontSize: 10, padding: '2px 7px' }}>No</button>
                      <button className="tv-icon-btn" onClick={() => { setConfirmingDelete(false); onDelete(meeting) }} style={{ fontSize: 10, padding: '2px 7px', color: 'var(--live)', fontWeight: 600 }}>Yes</button>
                    </div>
                  ) : (
                    <button className="tv-sidebar-action-btn is-danger" onClick={() => setConfirmingDelete(true)}>
                      <svg width="13" height="13" viewBox="0 0 11 11" fill="none"><path d="M1.5 2.5H9.5M4 2.5V1.5H7V2.5M2.5 2.5L3 9.5H8L8.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Delete recording
                    </button>
                  )
                )}
              </div>
            )}

            <div className="tv-sidebar-divider" />

            {/* Recording meta */}
            <div className="tv-sidebar-meta">
              <div>
                {[
                  formatDuration(meeting.duration_seconds),
                  wordCount > 0 ? `~${wordCount.toLocaleString()} words` : null,
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
        <div className="tv-audio-bar" style={{ flexShrink: 0 }}>
          {audioStatus?.is_silent && (
            <div style={{ fontSize: 11, color: 'var(--warning-amber)', marginBottom: 6 }}>
              Signal appears silent{audioStatus.peak_db != null ? ` (${audioStatus.peak_db.toFixed(1)} dB peak)` : ''}. Check microphone or enable system audio in Settings.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="2" y="4" width="2.5" height="8" rx="1" fill="currentColor" opacity="0.45"/>
              <rect x="6.75" y="2" width="2.5" height="12" rx="1" fill="currentColor" opacity="0.7"/>
              <rect x="11.5" y="5" width="2.5" height="6" rx="1" fill="currentColor" opacity="0.45"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {meeting.title}
            </span>
            {audioStatus?.bytes ? (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.7, flexShrink: 0 }}>
                {(audioStatus.bytes / 1024 / 1024).toFixed(1)} MB
              </span>
            ) : null}
          </div>
          <audio
            ref={audioRef}
            controls
            src={audioSrc}
            style={{ display: 'block', width: '100%', height: 32, accentColor: 'var(--accent)' }}
            onError={() => setAudioError('Playback failed to load this recording')}
          />
        </div>
      ) : null}

      {/* Speaker-labeled transcript (AI-inferred) */}
      {speakerTranscript !== null && (
        <div
          onClick={() => setSpeakerTranscript(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9997, background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-app)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 12,
              width: 'min(720px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Speakers (AI-inferred)</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Labels are estimated from the transcript, not acoustic analysis.</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="ghost-pill"
                  onClick={() => { void navigator.clipboard.writeText(speakerTranscript); window.dispatchEvent(new CustomEvent('memosa:toast', { detail: { message: 'Copied' } })) }}
                >Copy</button>
                <button className="ghost-pill is-selected-pill" onClick={() => setSpeakerTranscript(null)}>Close</button>
              </div>
            </div>
            <div style={{ padding: 16, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6 }}>
              {speakerTranscript}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
