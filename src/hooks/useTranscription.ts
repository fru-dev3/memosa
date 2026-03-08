import { useCallback, useEffect } from 'react'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useMemosaStore } from '../store'
import * as api from '../lib/tauri'
import type { WhisperModel } from '../lib/types'

export function useTranscriptionEvents() {
  const {
    upsertMeeting,
    clearModelDownloadProgress,
    clearTranscriptionProgress,
    clearTranscriptionError,
    setAvailableModels,
    setModelDownloadProgress,
    setTranscriptionProgress,
    setTranscriptionError,
  } = useMemosaStore()

  useEffect(() => {
    const unlisteners: Array<() => void> = []

    api.onTranscriptionProgress((data) => {
      setTranscriptionProgress(data.meeting_id, {
        progress: data.progress,
        partial_text: data.partial_text,
      })
    }).then(fn => unlisteners.push(fn))

    api.onTranscriptionComplete((data) => {
      clearTranscriptionProgress(data.meeting_id)
      clearTranscriptionError(data.meeting_id)
      api.getMeeting(data.meeting_id)
        .then(async meeting => {
          upsertMeeting(meeting)
          try {
            let granted = await isPermissionGranted()
            if (!granted) {
              const perm = await requestPermission()
              granted = perm === 'granted'
            }
            if (granted) {
              sendNotification({
                title: 'Transcript ready',
                body: meeting.title || 'Untitled memo',
              })
            }
          } catch { /* non-critical — ignore notification errors */ }
        })
        .catch(() => {})
    }).then(fn => unlisteners.push(fn))

    api.onTranscriptionFailed((data) => {
      clearTranscriptionProgress(data.meeting_id)
      setTranscriptionError(data.meeting_id, data.error)
      api.getMeeting(data.meeting_id)
        .then(meeting => upsertMeeting(meeting))
        .catch(() => {})
    }).then(fn => unlisteners.push(fn))

    api.onModelDownloadProgress((data) => {
      setModelDownloadProgress(data.model, data.progress)
    }).then(fn => unlisteners.push(fn))

    api.onModelDownloadComplete(async (data) => {
      clearModelDownloadProgress(data.model)
      try {
        const models = await api.getAvailableModels()
        setAvailableModels(models)
      } catch {
        // Ignore refresh failures; the next manual refresh will recover.
      }
    }).then(fn => unlisteners.push(fn))

    api.onModelDownloadFailed((data) => {
      clearModelDownloadProgress(data.model)
    }).then(fn => unlisteners.push(fn))

    return () => {
      unlisteners.forEach(fn => fn())
    }
  }, [
    clearModelDownloadProgress,
    clearTranscriptionError,
    clearTranscriptionProgress,
    setAvailableModels,
    setModelDownloadProgress,
    setTranscriptionProgress,
    setTranscriptionError,
    upsertMeeting,
  ])
}

export function useTranscription() {
  const { transcriptionProgress, modelDownloadProgress, clearTranscriptionError } = useMemosaStore()

  const startTranscription = useCallback(async (audioPath: string, meetingId: string, model: WhisperModel) => {
    clearTranscriptionError(meetingId)
    await api.transcribeAudio(audioPath, meetingId, model)
  }, [clearTranscriptionError])

  const cancelTranscription = useCallback(async (meetingId: string) => {
    await api.cancelTranscription(meetingId)
  }, [])

  const downloadModel = useCallback(async (model: WhisperModel) => {
    await api.downloadModel(model)
  }, [])

  return {
    progressMap: transcriptionProgress,
    modelProgress: modelDownloadProgress,
    startTranscription,
    cancelTranscription,
    downloadModel,
  }
}
