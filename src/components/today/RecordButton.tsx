import { useState, useEffect } from 'react'
import { useMemosaStore } from '../../store'
import { useRecording } from '../../hooks/useRecording'

function generateMeetingId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getTimeSuggestion(): string {
  const h = new Date().getHours()
  if (h < 10) return 'Morning session'
  if (h < 12) return 'Late morning'
  if (h < 14) return 'Lunch meeting'
  if (h < 17) return 'Afternoon session'
  if (h < 20) return 'Evening capture'
  return 'Late session'
}

// ─── Live clock ───────────────────────────────────────────────────

function useClock() {
  const fmt = () => {
    const now = new Date()
    return {
      time: now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      day: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    }
  }
  const [display, setDisplay] = useState(fmt)
  useEffect(() => {
    const id = setInterval(() => setDisplay(fmt()), 30_000)
    return () => clearInterval(id)
  }, [])
  return display
}

function LiveClock() {
  const { time } = useClock()
  return (
    <div className="qr-clock-wrap">
      <span className="qr-clock-time">{time}</span>
    </div>
  )
}

// ─── Ambient waveform ─────────────────────────────────────────────

function AmbientWaveform() {
  const bars = Array.from({ length: 48 }, (_, i) => {
    const phase = (i / 47) * Math.PI
    const base = Math.sin(phase) * 0.62 + 0.28
    const texture = Math.sin(i * 2.3) * 0.13 + Math.sin(i * 5.7) * 0.07
    return Math.max(0.08, Math.min(1, base + texture))
  })

  return (
    <div className="qr-waveform">
      <svg width="100%" height="52" viewBox="0 0 288 52" preserveAspectRatio="xMidYMid meet">
        {bars.map((h, i) => {
          const barH = h * 44
          const x = (i / 47) * 282 + 3
          const y = (52 - barH) / 2
          const dur = 1.4 + (i % 7) * 0.26
          const delay = (i % 11) * 0.14
          return (
            <rect
              key={i}
              x={x} y={y}
              width="3.5" height={barH}
              rx="1.75"
              fill="var(--accent)"
              opacity={0.15 + h * 0.5}
              style={{
                transformBox: 'fill-box',
                transformOrigin: '50% 50%',
                animation: `qrWave ${dur}s ease-in-out ${delay}s infinite alternate`,
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

// ─── Rec dot ──────────────────────────────────────────────────────

function RecDot() {
  return (
    <span style={{
      display: 'inline-block',
      width: 9, height: 9,
      borderRadius: '50%',
      background: 'white',
      flexShrink: 0,
      boxShadow: '0 0 0 2px rgba(255,255,255,0.35)',
    }} />
  )
}

// ─── RecordButton ─────────────────────────────────────────────────

export function RecordButton() {
  const { availableModels, recordingGuardMessage, recordingStatus, selectedProfileId, setActiveView, setRecordingGuardMessage } = useMemosaStore()
  const { startRecording } = useRecording()
  const hasModel = availableModels.length > 0 && availableModels.some(m => m.downloaded)
  const [titleInput, setTitleInput] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <LiveClock />

      <AmbientWaveform />

      <div style={{ marginBottom: 14 }}>
        <input
          type="text"
          placeholder={getTimeSuggestion()}
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
              el.style.boxShadow = '0 30px 42px rgba(33,128,72,0.26), 0 8px 18px rgba(58,45,34,0.1)'
            }
          }}
          onMouseLeave={e => {
            if (!starting) {
              const el = e.currentTarget as HTMLElement
              el.style.background = 'var(--accent)'
              el.style.transform = 'translateY(0)'
              el.style.boxShadow = '0 18px 28px rgba(33,128,72,0.22), 0 4px 12px rgba(58,45,34,0.08)'
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
              <span className="spinner" style={{
                width: 12, height: 12,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: 'white',
                display: 'block',
              }} />
              Starting…
            </>
          ) : (
            <>
              <RecDot />
              Record
            </>
          )}
        </button>
      </div>

      {!error && !recordingGuardMessage && !hasModel && (
        <div style={{ marginTop: 4, padding: '8px 12px', borderRadius: 9, background: 'rgba(226,153,45,0.1)', border: '1px solid rgba(226,153,45,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--warning-amber)', lineHeight: 1.4 }}>
            No Whisper model — audio captured but not transcribed.
          </p>
          <button
            type="button"
            onClick={() => setActiveView('settings')}
            style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning-amber)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, whiteSpace: 'nowrap', fontFamily: 'inherit', textDecoration: 'underline' }}
          >
            Download
          </button>
        </div>
      )}

      {!error && !recordingGuardMessage && hasModel && (
        <div className="quick-record-hint-row">
          <span>Press return to start</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ fontFamily: 'inherit', fontSize: 10, background: 'rgba(0,0,0,0.06)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 5px', letterSpacing: 0 }}>⇧⌘R</kbd>
            <span>anytime</span>
          </span>
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
