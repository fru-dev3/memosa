import { useCallback, useEffect, useRef } from 'react'
import { useMemosaStore } from '../store'
import * as api from '../lib/tauri'

export function useRecordingEvents() {
  const {
    recordingStatus, setRecordingStatus, setAudioLevel,
    appendLiveTranscriptLine, clearLiveTranscript,
    screenshotCaptureEnabled, screenshotIntervalMinutes,
    setScreenshotCount, setScreenshotCountdown,
  } = useMemosaStore()

  const countdownRef = useRef<number | null>(null)

  const startCountdown = (intervalSecs: number) => {
    stopCountdown()
    setScreenshotCountdown(intervalSecs)
    countdownRef.current = window.setInterval(() => {
      useMemosaStore.setState((s) => {
        const next = (s.screenshotCountdown ?? 1) - 1
        return { screenshotCountdown: next <= 0 ? intervalSecs : next }
      })
    }, 1000)
  }

  const stopCountdown = () => {
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current)
      countdownRef.current = null
    }
    setScreenshotCountdown(null)
    setScreenshotCount(0)
  }

  useEffect(() => {
    let mounted = true
    let unlisten1: (() => void) | null = null
    let unlisten2: (() => void) | null = null
    let unlisten3: (() => void) | null = null
    let unlisten4: (() => void) | null = null

    api.getRecordingStatus()
      .then((status) => { if (mounted) setRecordingStatus(status) })
      .catch(() => {})

    api.onRecordingStatusChanged((status) => {
      setRecordingStatus(status)
      if (!status.is_recording) {
        setAudioLevel(0)
        api.stopLiveTranscription().catch(() => {})
        api.stopScreenshotCapture().catch(() => {})
        stopCountdown()
      } else if (status.meeting_id) {
        clearLiveTranscript()
        api.startLiveTranscription(status.meeting_id).catch(() => {})
        if (screenshotCaptureEnabled) {
          api.getMeeting(status.meeting_id)
            .then((meeting) => {
              const folder = meeting.audio_path.replace(/[/\\][^/\\]+$/, '')
              const intervalSecs = screenshotIntervalMinutes * 60
              api.startScreenshotCapture(folder, meeting.title, intervalSecs).catch(() => {})
              startCountdown(intervalSecs)
            })
            .catch(() => {})
        }
      }
    }).then(fn => { unlisten1 = fn })

    api.onAudioLevel((level) => setAudioLevel(level))
      .then(fn => { unlisten2 = fn })

    api.onLiveTranscriptChunk((data) => appendLiveTranscriptLine(data.text))
      .then(fn => { unlisten3 = fn })

    // screenshot-taken: sync count, reset countdown
    api.onScreenshotTaken(({ count }) => {
      setScreenshotCount(count)
      const intervalSecs = useMemosaStore.getState().screenshotIntervalMinutes * 60
      setScreenshotCountdown(intervalSecs)
    }).then(fn => { unlisten4 = fn })

    return () => {
      mounted = false
      unlisten1?.(); unlisten2?.(); unlisten3?.(); unlisten4?.()
    }
  }, [setRecordingStatus, setAudioLevel, appendLiveTranscriptLine, clearLiveTranscript])

  useEffect(() => {
    if (!recordingStatus.is_recording) return
    const id = window.setInterval(() => {
      api.getRecordingStatus()
        .then((status) => {
          setRecordingStatus(status)
          if (!status.is_recording) setAudioLevel(0)
        })
        .catch(() => {})
    }, 1000)
    return () => window.clearInterval(id)
  }, [recordingStatus.is_recording, setAudioLevel, setRecordingStatus])
}

export function useRecording() {
  const startRecording = useCallback(async (meetingId: string, title: string, profileId?: string) => {
    await api.startRecording(meetingId, title, profileId)
  }, [])

  const stopRecording = useCallback(async () => {
    return await api.stopRecording()
  }, [])

  return { startRecording, stopRecording }
}
