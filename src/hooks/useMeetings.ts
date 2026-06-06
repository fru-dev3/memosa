import { useEffect, useCallback, useState } from 'react'
import { useMemosaStore } from '../store'
import * as api from '../lib/tauri'
import type { MeetingFilter } from '../lib/types'

const DEFAULT_FILTER: MeetingFilter = {}

export function useMeetings(filter: MeetingFilter = DEFAULT_FILTER) {
  const { meetings, removeMeeting, setMeetings, upsertMeeting } = useMemosaStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const filterKey = JSON.stringify(filter)

  const loadMeetings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMeetings(JSON.parse(filterKey) as MeetingFilter)
      setMeetings(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load meetings')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, setMeetings])

  useEffect(() => {
    loadMeetings()
  }, [loadMeetings])

  useEffect(() => {
    const unlisteners: Array<() => void> = []

    api.onMeetingSaved((meeting) => {
      upsertMeeting(meeting)
    }).then(fn => unlisteners.push(fn))

    api.onMeetingDeleted(({ id }) => {
      removeMeeting(id)
    }).then(fn => unlisteners.push(fn))

    return () => {
      unlisteners.forEach(fn => fn())
    }
  }, [removeMeeting, upsertMeeting])

  const deleteMeeting = useCallback(async (id: string) => {
    await api.deleteMeeting(id)
    removeMeeting(id)
  }, [removeMeeting])

  const openFolder = useCallback(async (id: string) => {
    await api.openMeetingFolder(id)
  }, [])

  return { meetings, loading, error, refresh: loadMeetings, deleteMeeting, openFolder }
}
