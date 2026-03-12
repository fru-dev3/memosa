import { Component, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CommandPalette } from './components/layout/CommandPalette'
import { FloatingRecorder } from './components/layout/FloatingRecorder'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { useRecordingEvents } from './hooks/useRecording'
import { useTranscriptionEvents } from './hooks/useTranscription'
import type { RecordingProfile } from './lib/types'
import * as api from './lib/tauri'
import { useMemosaStore } from './store'
import { AboutView } from './views/AboutView'
import { ProjectsView } from './views/ProjectsView'
import { ProfilesView } from './views/ProfilesView'
import { SearchView } from './views/SearchView'
import { SettingsView } from './views/SettingsView'
import { TemplatesView } from './views/TemplatesView'
import { TodayView } from './views/TodayView'
import { ExportView } from './views/ExportView'
import { SetupView } from './views/SetupView'

type PrimaryView = 'today' | 'projects' | 'search' | 'export'

type SafeModalView = 'settings' | 'profiles' | 'templates' | 'about' | null

class ViewErrorBoundary extends Component<
  { onReset?: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('view render failed', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24 }}>
          <div className="settings-message is-error" style={{ margin: 0 }}>
            This view failed to load. Memosa returned to a safe state.
          </div>
          {this.props.onReset ? (
            <button className="ghost-pill is-selected-pill" style={{ marginTop: 12 }} onClick={this.props.onReset}>
              Back to Today
            </button>
          ) : null}
        </div>
      )
    }

    return this.props.children
  }
}

function Toast() {
  const [message, setMessage] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<{ message: string }>).detail.message
      if (timerRef.current) clearTimeout(timerRef.current)
      setMessage(msg)
      setVisible(true)
      timerRef.current = setTimeout(() => setVisible(false), 2400)
    }
    window.addEventListener('memosa:toast', handler)
    return () => window.removeEventListener('memosa:toast', handler)
  }, [])

  if (!message) return null

  return (
    <div style={{
      position: 'fixed', bottom: 52, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, pointerEvents: 'none',
      opacity: visible ? 1 : 0,
      transition: 'opacity 260ms ease',
    }}>
      <div style={{
        padding: '8px 18px', borderRadius: 999,
        background: 'rgba(28, 26, 23, 0.88)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: '#fff', fontSize: 12, fontWeight: 500,
        boxShadow: '0 4px 18px rgba(0,0,0,0.22)',
        whiteSpace: 'nowrap',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        {message}
      </div>
    </div>
  )
}

export default function App() {
  const {
    activeView,
    commandPaletteOpen,
    profiles,
    recordingStatus,
    removeMeeting,
    selectedProfileId,
    setAvailableModels,
    setCommandPaletteOpen,
    setProfiles,
    setActiveView,
    settings,
    setSettings,
    upsertMeeting,
    loadFoldersFromDb,
  } = useMemosaStore()

  useRecordingEvents()
  useTranscriptionEvents()

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
    api.getAvailableModels().then(setAvailableModels).catch(() => {})
    api.loadProfiles().then(data => {
      if (Array.isArray(data) && data.length > 0) {
        setProfiles(data as RecordingProfile[])
      }
    }).catch(() => {})
    loadFoldersFromDb()
  }, [setAvailableModels, setProfiles, setSettings, loadFoldersFromDb])

  useEffect(() => {
    const root = document.documentElement
    const applyTheme = () => {
      const mode = settings?.appearance_mode ?? 'light'
      const resolved = mode === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode
      root.dataset.theme = resolved
    }

    applyTheme()
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [settings?.appearance_mode])

  useEffect(() => {
    const unlisteners: Array<() => void> = []
    api.onMeetingSaved(meeting => upsertMeeting(meeting)).then(u => unlisteners.push(u))
    api.onMeetingDeleted(({ id }) => removeMeeting(id)).then(u => unlisteners.push(u))
    return () => unlisteners.forEach(u => u())
  }, [removeMeeting, upsertMeeting])

  // Global hotkey events from Rust (system-wide, fire even when app is not focused)
  useEffect(() => {
    const unlisteners: Array<() => void> = []

    api.onGlobalHotkeyToggleRecording(() => {
      if (recordingStatus.is_recording) {
        void api.stopRecording()
      } else {
        void api.startRecording(`manual-${Date.now()}`, 'Quick Recording', selectedProfileId)
      }
    }).then(u => unlisteners.push(u))

    api.onGlobalHotkeyPalette(() => {
      setCommandPaletteOpen(true)
    }).then(u => unlisteners.push(u))

    api.onTrayToggleRecording(() => {
      if (recordingStatus.is_recording) {
        void api.stopRecording()
      } else {
        void api.startRecording(`manual-${Date.now()}`, 'Quick Recording', selectedProfileId)
      }
    }).then(u => unlisteners.push(u))

    return () => unlisteners.forEach(u => u())
  }, [
    recordingStatus.is_recording,
    selectedProfileId,
    setCommandPaletteOpen,
  ])

  // ⌘1-4 view switching
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey || e.repeat) return
      const viewMap: Record<string, PrimaryView> = { '1': 'today', '2': 'projects', '3': 'search' }
      const view = viewMap[e.key]
      if (view) { e.preventDefault(); setActiveView(view) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setActiveView])

  // In-app keyboard shortcut: ⇧⌘R toggles recording (complements the Rust global hotkey)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'r' && !e.repeat) {
        e.preventDefault()
        if (recordingStatus.is_recording) {
          void api.stopRecording()
        } else {
          void api.startRecording(`manual-${Date.now()}`, 'Quick Recording', selectedProfileId)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [recordingStatus.is_recording, selectedProfileId])

  // Auto-save profiles to Rust storage when they change (debounced)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.saveProfiles(profiles).catch(() => {})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [profiles])

  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) void invoke('start_window_drag')
  }, [])

  const views: Record<PrimaryView, ReactElement> = {
    today:    <TodayView />,
    projects: <ProjectsView />,
    search:   <SearchView />,
    export:   <ExportView />,
  }

  const modalViews = new Set(['settings', 'profiles', 'templates', 'about', 'privacy'] as const)
  const primaryViews = new Set<PrimaryView>(['today', 'projects', 'search', 'export'])

  useEffect(() => {
    if (!primaryViews.has(activeView as PrimaryView) && !modalViews.has(activeView as typeof modalViews extends Set<infer T> ? T : never)) {
      setActiveView('today')
    }
  }, [activeView, setActiveView])

  const resolvedModalView: SafeModalView = activeView === 'privacy'
    ? 'settings'
    : activeView === 'settings' || activeView === 'profiles' || activeView === 'templates' || activeView === 'about'
      ? activeView
      : null
  const primaryView: PrimaryView = primaryViews.has(activeView as PrimaryView)
    ? activeView as PrimaryView
    : 'today'

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg-app)',
      color: 'var(--text-primary)',
    }}>
      <CommandPalette />
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="app-main-drag" onMouseDown={handleDragMouseDown}>
          <div className="app-main-drag-handle" />
        </div>
        <FloatingRecorder />
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <ViewErrorBoundary onReset={() => setActiveView('today')}>
            {views[primaryView]}
          </ViewErrorBoundary>
        </main>
        <StatusBar />
        <ViewErrorBoundary onReset={() => setActiveView('today')}>
          {resolvedModalView === 'settings' ? <SettingsView /> : null}
          {resolvedModalView === 'profiles' ? <ProfilesView /> : null}
          {resolvedModalView === 'templates' ? <TemplatesView /> : null}
          {resolvedModalView === 'about' ? <AboutView /> : null}
        </ViewErrorBoundary>
      </div>
      {/* Setup overlay — rendered on top of the main app so backdrop blur has real content */}
      {settings != null && !settings.has_completed_setup && <SetupView />}
      <Toast />
    </div>
  )
}
