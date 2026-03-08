import { useEffect, useRef, useState } from 'react'
import * as api from '../../lib/tauri'
import type { Meeting } from '../../lib/types'
import { useMemosaStore } from '../../store'

function fmtTimer(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function AudioBars({ level }: { level: number }) {
  const BAR_COUNT = 20
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 32 }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => {
        const naturalH = 6 + Math.sin((i / (BAR_COUNT - 1)) * Math.PI) * 20
        const activeThreshold = i / BAR_COUNT
        const active = level > activeThreshold
        const color = active
          ? i < BAR_COUNT * 0.6
            ? 'var(--accent)'
            : i < BAR_COUNT * 0.85
              ? '#f59e0b'
              : 'var(--live)'
          : 'var(--border)'
        return (
          <div
            key={i}
            style={{
              width: 3,
              height: naturalH,
              borderRadius: 2,
              background: color,
              transition: 'background 60ms ease',
              flexShrink: 0,
            }}
          />
        )
      })}
    </div>
  )
}

function StopIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  )
}

export function LiveMeetingView({ meeting }: { meeting: Meeting }) {
  const { audioLevel, recordingStatus, liveTranscriptLines } = useMemosaStore()

  const isLive = recordingStatus.is_recording && recordingStatus.meeting_id === meeting.id
  const partialText = liveTranscriptLines.join(' ')

  const [title, setTitle] = useState(meeting.title)
  const [notes, setNotes] = useState('')
  const [copiedNotes, setCopiedNotes] = useState(false)
  const [notesState, setNotesState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const titleTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Keep title in sync if meeting changes externally
  useEffect(() => { setTitle(meeting.title) }, [meeting.title])

  useEffect(() => {
    let cancelled = false
    void api.readMeetingNotes(meeting.id).then((content) => {
      if (!cancelled) setNotes(content)
    }).catch(() => {
      if (!cancelled) setNotes('')
    })
    return () => {
      cancelled = true
    }
  }, [meeting.id])

  // Auto-scroll transcript as text arrives
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [partialText])

  const handleTitleChange = (value: string) => {
    setTitle(value)
    if (titleTimeout.current) clearTimeout(titleTimeout.current)
    titleTimeout.current = setTimeout(() => {
      void api.renameMeeting(meeting.id, value)
    }, 600)
  }

  const handleCopyNotes = async () => {
    await navigator.clipboard.writeText(notes)
    setCopiedNotes(true)
    setTimeout(() => setCopiedNotes(false), 1600)
  }

  const handleNotesChange = (value: string) => {
    setNotes(value)
    setNotesState('saving')
    if (notesTimeout.current) clearTimeout(notesTimeout.current)
    notesTimeout.current = setTimeout(() => {
      void api.saveMeetingNotes(meeting.id, value).then(() => {
        setNotesState('saved')
        setTimeout(() => setNotesState('idle'), 1600)
      }).catch(() => {
        setNotesState('idle')
      })
    }, 450)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '18px 24px 16px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
        background: isLive ? 'var(--live-dim)' : 'transparent',
        transition: 'background 300ms ease',
      }}>
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {isLive && (
            <span style={{
              width: 7, height: 7, borderRadius: 999,
              background: 'var(--live)', flexShrink: 0,
              animation: 'pulse 1.4s ease-in-out infinite',
              display: 'inline-block',
            }} />
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.7px',
            textTransform: 'uppercase',
            color: isLive ? 'var(--live)' : 'var(--text-muted)',
          }}>
            {isLive ? 'Live' : 'Recording ended'}
          </span>
          {isLive && recordingStatus.duration_seconds != null && (
            <span style={{
              fontSize: 12, fontVariantNumeric: 'tabular-nums',
              color: 'var(--text-secondary)', fontWeight: 600,
            }}>
              {fmtTimer(recordingStatus.duration_seconds)}
            </span>
          )}
          {isLive && (
            <button
              onClick={() => void api.stopRecording()}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--live-border)',
                background: 'var(--live-dim)', color: 'var(--live)',
                fontWeight: 600, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <StopIcon />
              Stop
            </button>
          )}
        </div>

        {/* Editable title */}
        <input
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          style={{
            width: '100%', border: 'none', background: 'transparent', outline: 'none',
            fontSize: 20, fontWeight: 700, color: 'var(--text-primary)',
            fontFamily: 'var(--font-body)', padding: 0, marginBottom: 12,
          }}
          placeholder="Meeting title"
        />

        {/* Audio level bars — only during live */}
        {isLive && <AudioBars level={audioLevel} />}
      </div>

      {/* Two-panel body */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>

        {/* Notes panel */}
        <div style={{
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{
            padding: '11px 16px 8px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.65px', color: 'var(--text-muted)',
            }}>
              Your notes
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: notesState === 'saved' ? 'var(--accent)' : 'var(--text-secondary)' }}>
                {notesState === 'saving' ? 'Saving…' : notesState === 'saved' ? 'Saved' : notes.length > 0 ? 'Stored in this recording' : ''}
              </span>
              {notes.length > 0 && (
                <button
                  onClick={handleCopyNotes}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 11, color: copiedNotes ? 'var(--accent)' : 'var(--text-secondary)',
                    padding: '2px 0', fontFamily: 'inherit',
                  }}
                >
                  {copiedNotes ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
          </div>
          <textarea
            value={notes}
            onChange={(e) => handleNotesChange(e.target.value)}
            placeholder={isLive ? 'Type notes as you listen…' : 'Add notes about this recording…'}
            style={{
              flex: 1, resize: 'none', border: 'none', outline: 'none',
              padding: '14px 16px', fontSize: 13, lineHeight: 1.65,
              background: 'transparent', color: 'var(--text-primary)',
              fontFamily: 'var(--font-body)',
            }}
          />
        </div>

        {/* Live transcript panel */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            padding: '11px 16px 8px',
            borderBottom: '1px solid var(--border-subtle)',
            flexShrink: 0,
          }}>
            <span style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.65px', color: 'var(--text-muted)',
            }}>
              {partialText ? 'Transcribing' : isLive ? 'Transcript' : 'Transcript'}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
            {partialText ? (
              <>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)' }}>
                  {partialText}
                </p>
                <div ref={transcriptEndRef} />
              </>
            ) : isLive ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Live transcript will appear here in a moment. Speak clearly and Whisper will pick it up.
                </p>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {['Local Whisper', 'On-device', 'Private'].map((tag) => (
                    <span key={tag} className="chip chip-muted" style={{ fontSize: 10 }}>{tag}</span>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                No transcript yet.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
