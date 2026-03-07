import { useCallback, useEffect } from 'react'
import { useMemosaStore } from '../store'
import * as api from '../lib/tauri'

export function useRecordingEvents() {
  const { recordingStatus, setRecordingStatus, setAudioLevel } = useMemosaStore()

  useEffect(() => {
    let mounted = true
    let unlisten1: (() => void) | null = null
    let unlisten2: (() => void) | null = null

    api.getRecordingStatus()
      .then((status) => {
        if (mounted) setRecordingStatus(status)
      })
      .catch(() => {})

    api.onRecordingStatusChanged((status) => {
      setRecordingStatus(status)
      if (!status.is_recording) setAudioLevel(0)
    })
      .then(fn => { unlisten1 = fn })

    api.onAudioLevel((level) => setAudioLevel(level))
      .then(fn => { unlisten2 = fn })

    return () => {
      mounted = false
      unlisten1?.()
      unlisten2?.()
    }
  }, [setRecordingStatus, setAudioLevel])

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
