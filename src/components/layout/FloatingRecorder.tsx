import * as api from '../../lib/tauri'
import { useMemosaStore } from '../../store'
import { RecordingSession } from '../recording/RecordingSession'
import { useEffect, useState } from 'react'

function generateMeetingId() {
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function formatTimer(secs?: number) {
  const total = secs ?? 0
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
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

// ─── Icons ────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 7.5a5.5 5.5 0 0011 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M8 13v2M5.5 15h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Drawer sub-components ────────────────────────────────────────

function LiveTime() {
  const fmt = () =>
    new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  const [time, setTime] = useState(fmt)
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 30_000)
    return () => clearInterval(id)
  }, [])
  return <span className="qr-fd-time">{time}</span>
}

function MiniWave() {
  const heights = [0.35, 0.65, 1, 0.78, 0.5, 0.88, 0.62, 0.42, 0.8, 0.58, 0.44, 0.72, 0.9, 0.55]
  return (
    <div className="qr-fd-miniwave" aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          className="qr-fd-miniwave-bar"
          style={{
            height: `${Math.round(h * 14)}px`,
            animationDuration: `${1.1 + (i % 5) * 0.24}s`,
            animationDelay: `${(i % 7) * 0.11}s`,
          }}
        />
      ))}
    </div>
  )
}

// ─── FloatingRecorder ─────────────────────────────────────────────

export function FloatingRecorder() {
  const {
    activeView,
    activeFolderId,
    assignMeetingToProject,
    availableModels,
    folders,
    recordingStatus,
    selectedProfileId,
  } = useMemosaStore()

  const hasModel = availableModels.length > 0 && availableModels.some((m) => m.downloaded)
  const [expanded, setExpanded] = useState(false)
  const [keepLivePanelOpen, setKeepLivePanelOpen] = useState(false)
  const [titleInput, setTitleInput] = useState('')

  useEffect(() => {
    if (recordingStatus.is_recording) {
      setKeepLivePanelOpen(true)
      setExpanded(true)
    } else if (keepLivePanelOpen) {
      const id = setTimeout(() => {
        setKeepLivePanelOpen(false)
        setExpanded(false)
      }, 2200)
      return () => clearTimeout(id)
    }
  }, [recordingStatus.is_recording]) // eslint-disable-line react-hooks/exhaustive-deps

  if (
    activeView === 'settings' ||
    activeView === 'profiles' ||
    activeView === 'templates' ||
    activeView === 'about' ||
    activeView === 'privacy'
  ) {
    return null
  }

  const handleStart = () => {
    const meetingId = generateMeetingId()
    const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null
    const title = titleInput.trim() || (activeFolder ? activeFolder.name : 'Quick Memo')
    void api.startRecording(meetingId, title, selectedProfileId)
    if (activeFolder) {
      assignMeetingToProject(meetingId, activeFolder.id)
    }
    setTitleInput('')
    setExpanded(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleStart()
    if (e.key === 'Escape') setExpanded(false)
  }

  // ── Live recording state ─────────────────────────────────────────
  if (recordingStatus.is_recording || keepLivePanelOpen) {
    return (
      <div className="side-bookmark side-bookmark-live">
        <button
          type="button"
          className="side-bookmark-tab side-bookmark-tab-live"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse recording panel' : 'Expand recording panel'}
          title={expanded ? 'Collapse' : 'Show recording controls'}
        >
          <span className="side-bookmark-live-dot" />
          <span className="side-bookmark-vert-text">
            {formatTimer(recordingStatus.duration_seconds)}
          </span>
        </button>
        <div
          className={`side-bookmark-session-panel${
            expanded ? '' : ' side-bookmark-panel-hidden'
          }`}
        >
          <button
            type="button"
            className="side-bookmark-session-close"
            onClick={() => setExpanded(false)}
            aria-label="Close recording panel"
            title="Collapse"
          >
            <ChevronRightIcon />
          </button>
          <RecordingSession compact />
        </div>
      </div>
    )
  }

  // ── Idle state ───────────────────────────────────────────────────
  return (
    <div className={`side-bookmark ${expanded ? 'is-open' : ''}`}>
      <button
        type="button"
        className={`side-bookmark-tab ${expanded ? 'is-open' : ''}`}
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? 'Collapse recorder' : 'Start recording'}
        title={expanded ? 'Collapse recorder' : 'Quick record'}
      >
        {expanded ? <ChevronRightIcon /> : <MicIcon />}
      </button>

      {expanded && (
        <div className="side-bookmark-drawer qr-fd">
          {/* Header: waveform + clock */}
          <div className="qr-fd-header">
            <MiniWave />
            <LiveTime />
          </div>

          {/* Divider */}
          <div className="qr-fd-divider" />

          {/* Name input */}
          <input
            type="text"
            className="qr-fd-input"
            placeholder={getTimeSuggestion()}
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />

          {/* Record button */}
          <button type="button" className="qr-fd-btn" onClick={handleStart}>
            <span className="qr-fd-rec-dot" />
            Record
          </button>

          {/* Keyboard hint */}
          <div className="qr-fd-hint">
            <span>↩ start</span>
            <span className="qr-fd-hint-sep">·</span>
            <kbd className="qr-fd-kbd">⇧⌘R</kbd>
            <span>global</span>
            <span className="qr-fd-hint-sep">·</span>
            <span>esc close</span>
          </div>

          {!hasModel && (
            <div className="qr-fd-no-model">No model · audio only</div>
          )}
        </div>
      )}
    </div>
  )
}
