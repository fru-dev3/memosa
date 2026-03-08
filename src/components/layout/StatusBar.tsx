import * as api from '../../lib/tauri'
import { useMemosaStore } from '../../store'

function CameraIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}

declare const __MEMOSA_BUILD_STAMP__: string

function fmtTimer(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function StatusBar() {
  const { availableModels, meetings, recordingStatus, settings, setActiveView, setCurrentMeeting, screenshotCount, screenshotCountdown, screenshotCaptureEnabled } = useMemosaStore()

  const defaultModel = settings?.default_model ?? 'small'
  const modelInfo = availableModels.find((model) => model.name === defaultModel)
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
              {recordingStatus.duration_seconds != null ? fmtTimer(recordingStatus.duration_seconds) : 'Recording…'}
            </span>
            {currentMeeting && (
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                {currentMeeting.title}
              </span>
            )}
            {currentMeeting && (
              <button
                onClick={() => { setCurrentMeeting(currentMeeting); setActiveView('library') }}
                title="Go to live recording"
                style={{ margin: 0, padding: 0, border: 'none', background: 'transparent', color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: 0.85 }}
              >
                → Live
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {currentMeeting && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {screenshotCaptureEnabled && screenshotCount > 0 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {screenshotCount} snaps{screenshotCountdown != null ? ` · ${fmtCountdown(screenshotCountdown)}` : ''}
                  </span>
                )}
                <button
                  title="Capture screenshot now"
                  onClick={() => {
                    const folder = currentMeeting.audio_path.replace(/[/\\][^/\\]+$/, '')
                    void api.captureScreenshotNow(folder, currentMeeting.title)
                  }}
                  style={{ padding: '2px 5px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                  <CameraIcon />
                </button>
              </div>
            )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Ready</span>
            {pendingTranscriptions > 0 && (
              <span>{pendingTranscriptions} transcribing</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {!modelInfo?.downloaded && (
              <span style={{ color: 'var(--upcoming)' }}>
                Whisper {defaultModel} not downloaded
              </span>
            )}
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Local archive</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Build {__MEMOSA_BUILD_STAMP__}</span>
          </div>
        </>
      )}
    </div>
  )
}
