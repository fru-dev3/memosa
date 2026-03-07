import { Component, useEffect, type ReactElement, type ReactNode } from 'react'
import { CommandPalette } from './components/layout/CommandPalette'
import { FloatingRecorder } from './components/layout/FloatingRecorder'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { useCalendarEvents } from './hooks/useCalendar'
import { useRecordingEvents } from './hooks/useRecording'
import { useTranscriptionEvents } from './hooks/useTranscription'
import type { RecordingProfile } from './lib/types'
import * as api from './lib/tauri'
import { useMemosaStore } from './store'
import { AboutView } from './views/AboutView'
import { CalendarView } from './views/CalendarView'
import { LibraryView } from './views/LibraryView'
import { ProjectsView } from './views/ProjectsView'
import { ProfilesView } from './views/ProfilesView'
import { SearchView } from './views/SearchView'
import { SettingsView } from './views/SettingsView'
import { TemplatesView } from './views/TemplatesView'
import { TodayView } from './views/TodayView'
import { SetupView } from './views/SetupView'

type PrimaryView = 'today' | 'calendar' | 'library' | 'projects' | 'search'

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
  } = useMemosaStore()

  useRecordingEvents()
  useCalendarEvents()
  useTranscriptionEvents()

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
    api.getAvailableModels().then(setAvailableModels).catch(() => {})
    // Load persisted profiles from Rust storage
    api.loadProfiles().then(data => {
      if (Array.isArray(data) && data.length > 0) {
        setProfiles(data as RecordingProfile[])
      }
    }).catch(() => {})
  }, [setAvailableModels, setProfiles, setSettings])

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

  // Auto-save profiles to Rust storage when they change (debounced)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      api.saveProfiles(profiles).catch(() => {})
    }, 800)
    return () => window.clearTimeout(timer)
  }, [profiles])

  const views: Record<PrimaryView, ReactElement> = {
    today:    <TodayView />,
    calendar: <CalendarView />,
    library:  <LibraryView />,
    projects: <ProjectsView />,
    search:   <SearchView />,
  }

  const modalViews = new Set(['settings', 'profiles', 'templates', 'about', 'privacy'] as const)
  const primaryViews = new Set<PrimaryView>(['today', 'calendar', 'library', 'projects', 'search'])

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

  // Show setup screen for new installs. Existing users always have
  // has_completed_setup = true (set at load time in settings.rs).
  if (settings != null && !settings.has_completed_setup) {
    return <SetupView />
  }

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
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
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
    </div>
  )
}
