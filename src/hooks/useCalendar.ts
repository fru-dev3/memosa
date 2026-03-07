import { useCallback, useEffect, useRef } from 'react'
import { useMemosaStore } from '../store'
import * as api from '../lib/tauri'
export function useCalendarEvents() {
  const { setTodayEvents, setAuthStatus, setAutoRecord, setAutoRecordWarning } = useMemosaStore()
  const warningTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    const unlisteners: Array<() => void> = []

    api.getAuthStatus()
      .then(status => setAuthStatus(status))
      .catch(() => {})

    api.getAutoRecord()
      .then(enabled => setAutoRecord(enabled))
      .catch(() => {})

    api.getTodayEvents()
      .then(events => setTodayEvents(events))
      .catch(() => {})

    api.onCalendarEventsUpdated((events) => setTodayEvents(events))
      .then(fn => unlisteners.push(fn))

    api.onAutoRecordWarning((data) => {
      setAutoRecordWarning(data)

      if (warningTimeoutRef.current != null) {
        window.clearTimeout(warningTimeoutRef.current)
      }

      warningTimeoutRef.current = window.setTimeout(() => {
        setAutoRecordWarning(null)
      }, 30_000)
    }).then(fn => unlisteners.push(fn))

    return () => {
      if (warningTimeoutRef.current != null) {
        window.clearTimeout(warningTimeoutRef.current)
      }
      unlisteners.forEach(fn => fn())
    }
  }, [setTodayEvents, setAuthStatus, setAutoRecord, setAutoRecordWarning])
}

export function useCalendar() {
  const {
    setTodayEvents,
    setAuthStatus,
    setAutoRecord,
    authStatus,
    autoRecord,
    autoRecordWarning,
    setAutoRecordWarning,
  } = useMemosaStore()

  const refresh = useCallback(async () => {
    await api.refreshEvents()
    const events = await api.getTodayEvents()
    setTodayEvents(events)
  }, [setTodayEvents])

  const dismissWarning = useCallback(() => setAutoRecordWarning(null), [setAutoRecordWarning])

  const dismissAndSkipRecord = useCallback(() => {
    const eventId = autoRecordWarning?.event.id
    setAutoRecordWarning(null)
    if (!eventId) return
    void api.skipAutoRecordOnce(eventId)
  }, [autoRecordWarning, setAutoRecordWarning])

  const setAutoRecordEnabled = useCallback(async (enabled: boolean) => {
    await api.setAutoRecord(enabled)
    setAutoRecord(enabled)
  }, [setAutoRecord])

  return {
    authStatus,
    autoRecord,
    warning: autoRecordWarning,
    refresh,
    dismissWarning,
    dismissAndSkipRecord,
    setAutoRecordEnabled,
  }
}
