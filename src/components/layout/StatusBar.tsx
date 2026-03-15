import { useEffect, useState } from 'react'
import * as api from '../../lib/tauri'
import { useMemosaStore } from '../../store'

function fmtTimer(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function StatusBar() {
  const { meetings, recordingStatus, setActiveView, setCurrentMeeting } = useMemosaStore()
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    api.getAppVersion().then(setAppVersion).catch(() => {})
  }, [])

  const pendingTranscriptions = meetings.filter((meeting) => meeting.transcription_status === 'processing').length
  const isRecording = recordingStatus.is_recording
  const currentMeeting = isRecording && recordingStatus.meeting_id
    ? meetings.find(m => m.id === recordingStatus.meeting_id)
    : null

  return (
    <div
      style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        borderTop: '1px solid var(--border-subtle)',
        background: isRecording ? 'var(--live-dim)' : 'rgba(255,255,255,0.46)',
        fontSize: 11,
        padding: '0 18px',
        color: 'var(--text-secondary)',
        flexShrink: 0,
        backdropFilter: 'blur(14px)',
        transition: 'background 200ms ease',
      }}
    >
      {isRecording ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="live-dot" style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--live)', flexShrink: 0, animation: 'pulse 1.4s ease-in-out infinite' }} />
            <span style={{ color: 'var(--live)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {recordingStatus.duration_seconds != null ? fmtTimer(recordingStatus.duration_seconds) : 'Recording...'}
            </span>
            {currentMeeting && (
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {currentMeeting.title}
              </span>
            )}
            {currentMeeting && (
              <button
                onClick={() => { setCurrentMeeting(currentMeeting); setActiveView('projects') }}
                title="Go to live recording"
                style={{ margin: 0, padding: 0, border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: 0.85 }}
              >
                {'->'} Live
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => api.stopRecording()}
              style={{
                padding: '3px 10px', borderRadius: 6, border: '1px solid var(--live-border)',
                background: 'var(--live-dim)', color: 'var(--live)', fontWeight: 600,
                fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Stop
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pendingTranscriptions > 0 && (
              <span style={{ fontWeight: 600 }}>{pendingTranscriptions} transcribing</span>
            )}
          </div>
          <div>
            {appVersion && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>v{appVersion}</span>}
          </div>
        </>
      )}
    </div>
  )
}
