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

export function FloatingRecorder() {
  const { activeView, activeFolderId, assignMeetingToProject, folders, recordingStatus, selectedProfileId } = useMemosaStore()
  const [expanded, setExpanded] = useState(false)
  const [keepLivePanelOpen, setKeepLivePanelOpen] = useState(false)

  useEffect(() => {
    if (recordingStatus.is_recording) {
      setKeepLivePanelOpen(true)
    } else if (keepLivePanelOpen) {
      const id = setTimeout(() => {
        setKeepLivePanelOpen(false)
        setExpanded(false)
      }, 2200)
      return () => clearTimeout(id)
    }
  }, [recordingStatus.is_recording]) // eslint-disable-line react-hooks/exhaustive-deps

  if (activeView === 'settings' || activeView === 'profiles' || activeView === 'templates' || activeView === 'about' || activeView === 'privacy') {
    return null
  }

  const handleStart = () => {
    const meetingId = generateMeetingId()
    const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null
    const title = activeFolder ? activeFolder.name : 'Quick Memo'
    void api.startRecording(meetingId, title, selectedProfileId)
    if (activeFolder) {
      assignMeetingToProject(meetingId, activeFolder.id)
    }
  }

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
        {/* Always mounted so guard logic (auto-stop on no signal) keeps running */}
        <div className={`side-bookmark-session-panel${expanded ? '' : ' side-bookmark-panel-hidden'}`}>
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

  return (
    <div className={`side-bookmark ${expanded ? 'is-open' : ''}`}>
      <button
        type="button"
        className={`side-bookmark-tab ${expanded ? 'is-open' : ''}`}
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? 'Collapse recorder' : 'Expand recorder'}
        title={expanded ? 'Collapse recorder' : 'Start recording'}
      >
        {expanded ? <ChevronRightIcon /> : <MicIcon />}
      </button>
      {expanded && (
        <div className="side-bookmark-drawer">
          <button
            type="button"
            className="side-bookmark-record-btn"
            onClick={handleStart}
          >
            <MicIcon />
            <span>Record</span>
          </button>
        </div>
      )}
    </div>
  )
}
