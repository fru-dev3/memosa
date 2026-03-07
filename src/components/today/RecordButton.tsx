import { useState } from 'react'
import { useMemosaStore } from '../../store'
import { useRecording } from '../../hooks/useRecording'

function generateMeetingId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ─── Mic icon for the record button ──────────────────────────────

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="5.5" y="1" width="5" height="8" rx="2.5" stroke="white" strokeWidth="1.5"/>
      <path d="M2 7.5c0 3.314 2.686 6 6 6s6-2.686 6-6" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="13.5" x2="8" y2="15" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function StopSquare() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="2" fill="white"/>
    </svg>
  )
}

// ─── RecordButton ─────────────────────────────────────────────────

export function RecordButton() {
  const { recordingGuardMessage, recordingStatus, selectedProfileId, setRecordingGuardMessage } = useMemosaStore()
  const { startRecording } = useRecording()
  const [titleInput, setTitleInput] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // When recording, the FloatingRecorder handles all recording UI
  if (recordingStatus.is_recording) {
    return (
      <div className="quick-record-shell quick-record-hero quick-record-live-placeholder">
        <div className="quick-record-live-ring" aria-hidden="true" />
        <div className="quick-record-live-ring quick-record-live-ring-b" aria-hidden="true" />
        <div className="quick-record-live-core" aria-hidden="true" />
      </div>
    )
  }

  const handleStart = async () => {
    const title = titleInput.trim() || 'Untitled Meeting'
    setStarting(true)
    setError(null)
    setRecordingGuardMessage(null)
    try {
      await startRecording(generateMeetingId(), title, selectedProfileId)
      setTitleInput('')
    } catch (e) {
      setError(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Failed to start recording')
    } finally {
      setStarting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleStart()
  }

  return (
    <div className="quick-record-shell quick-record-hero">
      <div className="quick-record-label">New Memo</div>

      <div className="quick-record-title">
        Capture a memo
      </div>

      <div className="quick-record-copy">
        Give it a name or leave it blank — Memosa will save it as an untitled capture.
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Memo title or topic…"
          value={titleInput}
          onChange={e => setTitleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="quick-record-input"
          onFocus={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = 'var(--accent-border)'
            el.style.boxShadow = '0 0 0 5px rgba(21,62,124,0.07)'
          }}
          onBlur={e => {
            const el = e.currentTarget as HTMLElement
            el.style.borderColor = 'var(--border)'
            el.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.72)'
          }}
        />
      </div>

      <div className="quick-record-button-wrap">
        <button
          onClick={handleStart}
          disabled={starting}
          className="quick-record-button"
          style={{ opacity: starting ? 0.7 : 1 }}
          onMouseEnter={e => {
            if (!starting) {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'var(--accent-hover)'
              el.style.transform = 'translateY(-2px) scale(1.01)'
              el.style.boxShadow = '0 30px 42px rgba(21,62,124,0.24), 0 8px 18px rgba(58,45,34,0.1)'
            }
          }}
          onMouseLeave={e => {
            if (!starting) {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'var(--accent)'
              el.style.transform = 'translateY(0)'
              el.style.boxShadow = '0 22px 34px rgba(21,62,124,0.2), 0 4px 12px rgba(58,45,34,0.08)'
            }
          }}
          onMouseDown={e => {
            if (!starting) (e.currentTarget as HTMLElement).style.transform = 'scale(0.975) translateY(0)'
          }}
          onMouseUp={e => {
            if (!starting) (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px) scale(1.01)'
          }}
        >
          {starting ? (
            <>
              <span
                className="spinner"
                style={{
                  width: 14, height: 14,
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white',
                  display: 'block',
                }}
              />
              Starting…
            </>
          ) : (
            <>
              <MicIcon />
              Capture memo
            </>
          )}
        </button>
      </div>

      {!error && !recordingGuardMessage && (
        <div className="quick-record-hint-row">
          <span>Press return to start</span>
          <span>Saved locally</span>
        </div>
      )}

      {(error || recordingGuardMessage) && (
        <div className="quick-record-error">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--live)', lineHeight: 1.4 }}>{error ?? recordingGuardMessage}</p>
        </div>
      )}
    </div>
  )
}
