import { useEffect, useRef, useState } from 'react'
import * as api from '../../lib/tauri'
import { useMemosaStore } from '../../store'
import { Waveform } from './Waveform'
import { useRecording } from '../../hooks/useRecording'

const SIGNAL_WARNING_SECONDS = 5
const SIGNAL_STOP_SECONDS = 12
const SIGNAL_THRESHOLD = 0.0015
const VISUAL_SIGNAL_THRESHOLD = 0.0015

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function RecordingSession({ compact }: { compact?: boolean } = {}) {
  const {
    activeFolderId,
    audioLevel,
    recordingStatus,
    meetings,
    setActiveView,
    setCurrentMeeting,
    setRecordingGuardMessage,
    upsertMeeting,
  } = useMemosaStore()
  const { stopRecording } = useRecording()
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [noSignalWarning, setNoSignalWarning] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const peakLevelRef = useRef(0)
  const guardTriggeredRef = useRef(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const currentMeeting = recordingStatus.meeting_id
    ? meetings.find(m => m.id === recordingStatus.meeting_id)
    : null
  const signalDetected = audioLevel >= VISUAL_SIGNAL_THRESHOLD || peakLevelRef.current >= VISUAL_SIGNAL_THRESHOLD
  const waveformColor = signalDetected ? 'var(--accent)' : 'rgba(15,190,128,0.2)'
  const liveColor = signalDetected ? 'var(--accent)' : 'var(--warning-amber)'
  const liveBackground = signalDetected ? 'rgba(15,190,128,0.12)' : 'rgba(226,153,45,0.12)'
  const liveBorder = signalDetected ? 'rgba(15,190,128,0.22)' : 'rgba(226,153,45,0.22)'
  const levelPercent = Math.min(100, Math.round(Math.max(audioLevel, peakLevelRef.current) * 900))

  // Local tick counter
  useEffect(() => {
    if (!recordingStatus.is_recording) { setElapsed(0); return }
    setElapsed(recordingStatus.duration_seconds ?? 0)
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [recordingStatus.duration_seconds, recordingStatus.is_recording])

  // Reset stopping state when recording ends
  useEffect(() => {
    if (!recordingStatus.is_recording) {
      setStopping(false)
      setError(null)
      setNoSignalWarning(false)
      setEditingTitle(false)
      peakLevelRef.current = 0
      guardTriggeredRef.current = false
    }
  }, [recordingStatus.is_recording])

  useEffect(() => {
    setTitleDraft(currentMeeting?.title ?? '')
    setEditingTitle(false)
  }, [currentMeeting?.id, currentMeeting?.title])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  useEffect(() => {
    if (!recordingStatus.is_recording) return
    peakLevelRef.current = Math.max(peakLevelRef.current, audioLevel)
  }, [audioLevel, recordingStatus.is_recording])

  useEffect(() => {
    if (!recordingStatus.is_recording || stopping || guardTriggeredRef.current) return

    if (elapsed >= SIGNAL_WARNING_SECONDS) {
      setNoSignalWarning(peakLevelRef.current < SIGNAL_THRESHOLD)
    }

    if (elapsed < SIGNAL_STOP_SECONDS || peakLevelRef.current >= SIGNAL_THRESHOLD) {
      return
    }

    guardTriggeredRef.current = true
    setNoSignalWarning(true)
    setStopping(true)
    const message = 'No audio signal was detected, so Memosa stopped the recording. Check the selected microphone or turn on system audio capture before trying again.'
    setRecordingGuardMessage(message)
    setError(message)
    stopRecording()
      .catch((stopError) => {
        setError(stopError instanceof Error ? stopError.message : 'Failed to stop recording after no-signal detection')
        setStopping(false)
        guardTriggeredRef.current = false
      })
  }, [elapsed, recordingStatus.is_recording, setRecordingGuardMessage, stopRecording, stopping])

  const handleStop = async () => {
    setStopping(true)
    setError(null)
    try {
      const result = await stopRecording()
      const savedMeeting = await api.getMeeting(result.meeting_id)
      upsertMeeting(savedMeeting)
      setCurrentMeeting(savedMeeting)
      // Stay in projects if recording was started from a folder, otherwise go to library
      setActiveView(activeFolderId ? 'projects' : 'library')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop recording')
      setStopping(false)
    }
  }

  const handleTitleCommit = () => {
    if (!currentMeeting) return
    const trimmed = titleDraft.trim()
    if (!trimmed || trimmed === currentMeeting.title) {
      setTitleDraft(currentMeeting.title)
      setEditingTitle(false)
      return
    }
    api.renameMeeting(currentMeeting.id, trimmed).catch(() => {
      setTitleDraft(currentMeeting.title)
    })
    setEditingTitle(false)
  }

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') handleTitleCommit()
    if (event.key === 'Escape' && currentMeeting) {
      setTitleDraft(currentMeeting.title)
      setEditingTitle(false)
    }
  }

  if (!recordingStatus.is_recording) return null

  if (compact) {
    return (
      <div style={{ padding: '44px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: liveColor, display: 'block', flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase', color: liveColor }}>
            {signalDetected ? 'Signal live' : 'Listening…'}
          </span>
        </div>

        {currentMeeting ? (
          editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={handleTitleKeyDown}
              className="settings-input"
              style={{ padding: '6px 8px', fontSize: 12 }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              style={{ margin: 0, padding: 0, border: 'none', background: 'transparent', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3, cursor: 'text', textAlign: 'left' }}
              title="Click to rename"
            >
              {currentMeeting.title}
            </button>
          )
        ) : null}

        <div style={{ textAlign: 'center', padding: '6px 0' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, letterSpacing: '0.06em', fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', lineHeight: 1 }}>
            {formatTime(elapsed)}
          </span>
        </div>

        <div style={{ padding: '7px 10px', borderRadius: 10, border: `1px solid ${liveBorder}`, background: liveBackground }}>
          <Waveform color={waveformColor} height={28} />
        </div>

        {noSignalWarning && !error && (
          <div style={{ padding: '7px 10px', borderRadius: 8, background: 'rgba(226,153,45,0.12)', border: '1px solid rgba(226,153,45,0.24)' }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--warning-amber)', lineHeight: 1.4 }}>No audio signal detected yet.</p>
          </div>
        )}

        <button
          onClick={handleStop}
          disabled={stopping}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', padding: '10px', borderRadius: 10, border: '1px solid var(--live-border)', background: 'var(--live-dim)', color: 'var(--live)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: stopping ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: stopping ? 0.65 : 1 }}
        >
          {stopping ? 'Stopping…' : (
            <>
              <svg width="9" height="9" viewBox="0 0 11 11" fill="none" aria-hidden="true"><rect x="0.5" y="0.5" width="10" height="10" rx="2" fill="var(--live)" /></svg>
              Stop
            </>
          )}
        </button>

        {error && (
          <div style={{ padding: '7px 10px', borderRadius: 7, background: 'var(--live-dim)', border: '1px solid var(--live-border)' }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--live)', lineHeight: 1.4 }}>{error}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="quick-record-shell" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Recording status header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            className="live-dot"
            style={{ width: 7, height: 7, borderRadius: '50%', background: liveColor, display: 'block', flexShrink: 0 }}
          />
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.6px', textTransform: 'uppercase', color: liveColor }}>
            {signalDetected ? 'Signal live' : 'Listening for signal'}
          </span>
        </div>
        {currentMeeting ? (
          editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={handleTitleKeyDown}
              className="settings-input"
              style={{ marginTop: 2, padding: '8px 10px', fontSize: 13 }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              style={{
                margin: 0,
                padding: 0,
                border: 'none',
                background: 'transparent',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
                lineHeight: 1.3,
                cursor: 'text',
                textAlign: 'left',
              }}
              title="Click to rename while recording"
            >
              {currentMeeting.title}
            </button>
          )
        ) : null}
        <p style={{ margin: '6px 0 0', fontSize: 11, color: signalDetected ? 'var(--accent)' : 'var(--text-muted)', lineHeight: 1.4 }}>
          {signalDetected ? `Input activity ${levelPercent}%` : 'Waiting for visible audio activity'}
          {' '}<span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.5 }}>(rms:{audioLevel.toFixed(5)})</span>
        </p>
      </div>

      {/* Timer */}
      <div style={{ marginBottom: 20, textAlign: 'center' }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 44,
          fontWeight: 400,
          letterSpacing: '0.06em',
          fontVariantNumeric: 'tabular-nums',
          color: 'var(--text-primary)',
          lineHeight: 1,
          display: 'block',
        }}>
          {formatTime(elapsed)}
        </span>
      </div>

      {/* Waveform */}
      <div
        style={{
          marginBottom: 20,
          padding: '10px 12px',
          borderRadius: 16,
          border: `1px solid ${liveBorder}`,
          background: liveBackground,
        }}
      >
        <Waveform color={waveformColor} height={44} />
      </div>

      {noSignalWarning && !error ? (
        <div style={{
          marginBottom: 14,
          padding: '10px 12px',
          borderRadius: 10,
          background: 'rgba(226, 153, 45, 0.12)',
          border: '1px solid rgba(226, 153, 45, 0.24)',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--warning-amber)', lineHeight: 1.4 }}>
            No input signal is reaching Memosa yet. If the waveform stays flat, the recording will stop automatically.
          </p>
        </div>
      ) : null}

      {/* Stop button */}
      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: '12px',
          borderRadius: 16,
          border: '1px solid var(--live-border)',
          background: 'var(--live-dim)',
          color: 'var(--live)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: stopping ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          opacity: stopping ? 0.65 : 1,
          transition: 'background 120ms ease',
        }}
        onMouseEnter={e => {
          if (!stopping) (e.currentTarget as HTMLElement).style.background = 'rgba(240,92,92,0.18)'
        }}
        onMouseLeave={e => {
          if (!stopping) (e.currentTarget as HTMLElement).style.background = 'var(--live-dim)'
        }}
      >
        {stopping ? (
          <>
            <span
              className="spinner"
              style={{
                width: 13, height: 13,
                borderRadius: '50%',
                border: '2px solid rgba(240,92,92,0.3)',
                borderTopColor: 'var(--live)',
                display: 'block',
              }}
            />
            Stopping…
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <rect x="0.5" y="0.5" width="10" height="10" rx="2" fill="var(--live)"/>
            </svg>
            Stop Recording
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 10,
          padding: '8px 12px',
          borderRadius: 7,
          background: 'var(--live-dim)',
          border: '1px solid var(--live-border)',
        }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--live)', lineHeight: 1.4 }}>{error}</p>
        </div>
      )}

      {/* Info */}
      <p style={{ margin: '16px 0 0', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Recording locally now.
      </p>

    </div>
  )
}
