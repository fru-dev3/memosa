import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useCalendar } from '../hooks/useCalendar'
import { useTranscription } from '../hooks/useTranscription'
import * as api from '../lib/tauri'
import type {
  AmbientStatus,
  AppSettings,
  AudioDiagnostics,
  CleanupPreview,
  CleanupRunResult,
  MicrophoneProbeResult,
  StorageUsage,
  WhisperModel,
} from '../lib/types'
import { useMemosaStore } from '../store'

const DEFAULT_SETTINGS: AppSettings = {
  storage_path: '/Users/user/Documents/Memosa',
  default_model: 'small',
  auto_record: false,
  pre_meeting_notice_seconds: 120,
  calendar_provider: 'local_macos',
  capture_system_audio: true,
  launch_at_login: false,
  appearance_mode: 'light',
  retention_policy: {
    enabled: false,
    recordings_delete_after_days: 30,
    transcripts_delete_after_days: 60,
    archive_after_days: 14,
    keep_starred: true,
    keep_profiles: [],
  },
  ambient_mode: {
    enabled: false,
    buffer_minutes: 30,
    capture_microphone: true,
    capture_system_audio: false,
    active_start_hour: 9,
    active_end_hour: 18,
    excluded_apps: ['1Password', 'Messages'],
    max_daily_storage_mb: 1024,
    save_hotkey: 'Cmd+Shift+S',
  },
  integration_states: {
    google_drive: { enabled: false },
    box: { enabled: false },
    dropbox: { enabled: false },
    notion: { enabled: false },
    obsidian: { enabled: false },
    notebooklm: { enabled: false },
    snowflake: { enabled: false },
    supabase: { enabled: false },
    mysql: { enabled: false },
    postgresql: { enabled: false },
    webhook: { enabled: false },
  },
  summary_template_prompts: {
    meeting_brief: 'Summarize the meeting clearly. Highlight the main discussion, the most important decisions, and the next steps.',
    one_on_one_briefing: 'Summarize this 1:1 with emphasis on alignment, feedback, blockers, and follow-through.',
    customer_call: 'Summarize this customer call with emphasis on customer needs, pain points, commitments, and follow-up.',
    project_sync: 'Summarize this project sync with emphasis on status, risks, owners, and next milestones.',
    interview_notes: 'Summarize this interview with emphasis on candidate strengths, concerns, evidence, and recommendation.',
    personal_notes: 'Summarize this personal note with emphasis on reflections, ideas, and next actions.',
    action_items: 'Turn this conversation into a concise action list with owners, deadlines, and follow-up needs.',
    decision_log: 'Extract the decisions made, why they were made, and any unresolved questions.',
  },
  custom_summary_templates: [],
}

const MODEL_OPTIONS: WhisperModel[] = ['tiny', 'base', 'small', 'medium']
const NOTICE_OPTIONS = [
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '5 minutes', value: 300 },
]
const PRIVACY_PILLARS = [
  'No meeting bots',
  'No cloud processing in the current app flow',
  'Local transcription on your device',
  'Local storage in your chosen folder',
  'Transparent microphone and calendar permissions',
]
const PRIVACY_TRUST_SECTIONS = [
  {
    title: 'What gets recorded',
    body: 'Only the microphone or system audio sources you explicitly enable.',
  },
  {
    title: 'What stays local',
    body: 'Audio files, transcripts, and search content remain on-device in the current build.',
  },
  {
    title: 'Local models',
    body: 'Whisper runs on this Mac, so sensitive meeting audio does not need a remote transcription service.',
  },
]

const WHISPER_REPO_URL = 'https://github.com/openai/whisper'
const WHISPER_MODEL_CARD_URL = 'https://github.com/openai/whisper/blob/main/model-card.md'
const LOCAL_MODEL_NOTES: Record<WhisperModel, string> = {
  tiny: 'Fastest and lightest. Best when speed matters more than accuracy.',
  base: 'A balanced starting point for short recordings on-device.',
  small: 'Better accuracy with a larger local footprint.',
  medium: 'Most capable local option in this app, with the heaviest runtime cost.',
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 2.25H9.75V8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2.5L2.25 9.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6.25L4.6 8.85L10 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MicrophoneStatusIcon({ detectedSignal }: { detectedSignal: boolean }) {
  return (
    <div className={`settings-probe-icon ${detectedSignal ? 'is-ready' : 'is-warning'}`} aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <rect x="5.25" y="1.5" width="5.5" height="8.25" rx="2.75" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 8.25C3 11.011 5.239 13.25 8 13.25C10.761 13.25 13 11.011 13 8.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 13.25V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function SpeakerStatusIcon({ detectedSignal }: { detectedSignal: boolean }) {
  return (
    <div className={`settings-probe-icon ${detectedSignal ? 'is-ready' : 'is-warning'}`} aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
        <path d="M3 6.25H5.6L8.6 3.5V12.5L5.6 9.75H3V6.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10.5 6C11.3 6.55 11.75 7.2 11.75 8C11.75 8.8 11.3 9.45 10.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M12 4.5C13.15 5.45 13.75 6.6 13.75 8C13.75 9.4 13.15 10.55 12 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function TestWaveStrip({ active, failed, level }: { active: boolean; failed: boolean; level: number }) {
  const shapedLevel = active ? Math.min(1, Math.max(0, level * 9)) : 0
  return (
    <div className={`settings-test-wave ${active ? 'is-active' : ''} ${failed ? 'is-failed' : ''}`} aria-hidden="true">
      {Array.from({ length: 28 }, (_, index) => (
        <span
          key={index}
          className="settings-test-wave-bar"
          style={{
            animationDelay: `${index * 70}ms`,
            ['--wave-level' as string]: String(shapedLevel),
          }}
        />
      ))}
    </div>
  )
}

function RailProfileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 8a2.75 2.75 0 100-5.5A2.75 2.75 0 008 8z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 13.5c.7-2 2.6-3 5-3s4.3 1 5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RailCalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 6h13M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RailRecordIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="1.5" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 8c0 3.038 2.462 5.5 5.5 5.5S13.5 11.038 13.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RailPrivacyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.8l5 1.8v3.8c0 3.2-2 5.8-5 6.8-3-1-5-3.6-5-6.8V3.6L8 1.8z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function RailModelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 5.5L8 2.5L13 5.5V10.5L8 13.5L3 10.5V5.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function RailStorageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6.5H14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function RailShortcutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 8H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RailAppIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
function RailIntegrationsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 5.5h3.2M8.8 10.5H12M8 3v3M8 10v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="3" cy="5.5" r="1.3" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="13" cy="10.5" r="1.3" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="8" cy="8" r="1.55" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  )
}

const SECTION_ORDER = [
  'calendar',
  'recording',
  'privacy',
  'models',
  'storage',
  'shortcuts',
  'app',
  'integrations',
] as const

type SettingsSectionId = (typeof SECTION_ORDER)[number]

function inputStyles() {
  return {
    background: 'var(--settings-input-bg)',
    border: '1px solid var(--settings-input-border)',
    color: 'var(--text-primary)',
  }
}

function initialsFor(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'M'
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`
}

function SettingsBlock({
  title,
  detail,
  children,
}: {
  title: string
  detail?: string
  children: ReactNode
}) {
  return (
    <section className="settings-block">
      <div className="settings-block-header">
        <h2 className="settings-block-title">{title}</h2>
        {detail ? <p className="settings-block-copy">{detail}</p> : null}
      </div>
      <div className="settings-block-body">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="settings-field">
      <div className="settings-field-label-row">
        <div className="settings-field-label">{label}</div>
        {hint ? <div className="settings-field-hint">{hint}</div> : null}
      </div>
      {children}
    </label>
  )
}

function ToggleButton({
  value,
  onClick,
  onLabel = 'On',
  offLabel = 'Off',
  description,
}: {
  value: boolean
  onClick: () => void
  onLabel?: string
  offLabel?: string
  description?: string
}) {
  return (
    <button type="button" onClick={onClick} className="settings-toggle" style={inputStyles()}>
      <div>
        <div className="settings-toggle-state">{value ? onLabel : offLabel}</div>
        {description ? <div className="settings-toggle-copy">{description}</div> : null}
      </div>
      <span className={`settings-switch ${value ? 'is-on' : ''}`} aria-hidden="true">
        <span className="settings-switch-knob" />
      </span>
    </button>
  )
}

function SystemCheck({
  label,
  tone,
  value,
  detail,
}: {
  label: string
  tone: 'ok' | 'warn' | 'neutral'
  value: string
  detail: string
}) {
  return (
    <div className="settings-check">
      <div className="settings-check-row">
        <div className="settings-check-label">{label}</div>
        <span className={`settings-check-tone is-${tone}`}>{value}</span>
      </div>
      <div className="settings-check-copy">{detail}</div>
    </div>
  )
}

export function SettingsView() {
  const {
    autoRecord,
    setAutoRecordEnabled,
  } = useCalendar()
  const {
    availableModels,
    hotkeys,
    meetings,
    profiles,
    selectedProfileId,
    setActiveView,
    setAvailableModels,
    setAutoRecord,
    setHotkeys,
    setSettings,
    settings,
  } = useMemosaStore()
  const { downloadModel, modelProgress } = useTranscription()

  const [activeSection, setActiveSection] = useState<SettingsSectionId>('calendar')
  const [draft, setDraft] = useState<AppSettings>(settings ?? DEFAULT_SETTINGS)
  const [audioDiagnostics, setAudioDiagnostics] = useState<AudioDiagnostics | null>(null)
  const [inputDevices, setInputDevices] = useState<string[]>([])
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true)
  const [testingMicrophone, setTestingMicrophone] = useState(false)
  const [microphoneProbe, setMicrophoneProbe] = useState<MicrophoneProbeResult | null>(null)
  const [testingSystemAudio, setTestingSystemAudio] = useState(false)
  const [systemAudioProbe, setSystemAudioProbe] = useState<MicrophoneProbeResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickingStoragePath, setPickingStoragePath] = useState(false)
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupRunResult | null>(null)
  const [loadingCleanup, setLoadingCleanup] = useState(false)
  const [runningCleanup, setRunningCleanup] = useState(false)
  const [ambientStatus, setAmbientStatus] = useState<AmbientStatus | null>(null)
  const [ambientBusy, setAmbientBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const audioLevel = useMemosaStore((state) => state.audioLevel)

  const activeProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0]
  const profileInitials = initialsFor(activeProfile?.name ?? 'Memosa')

  useEffect(() => {
    setDraft(settings ?? DEFAULT_SETTINGS)
  }, [settings])

  useEffect(() => {
    api.getInputDevices().then(setInputDevices).catch(() => {})

    if (availableModels.length > 0) return
    api.getAvailableModels().then(setAvailableModels).catch(() => {})
  }, [availableModels.length, setAvailableModels])

  useEffect(() => {
    api.getStorageUsage().then(setStorageUsage).catch(() => {})
    api.previewCleanup().then(setCleanupPreview).catch(() => {})
    api.getAmbientStatus().then(setAmbientStatus).catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadingDiagnostics(true)

    api.getAudioDiagnostics(draft.audio_input_device, draft.capture_system_audio)
      .then((diagnostics) => {
        if (!cancelled) setAudioDiagnostics(diagnostics)
      })
      .catch(() => {
        if (!cancelled) setAudioDiagnostics(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingDiagnostics(false)
      })

    return () => {
      cancelled = true
    }
  }, [draft.audio_input_device, draft.capture_system_audio])

  const isDirty = useMemo(() => {
    const baseline = settings ?? DEFAULT_SETTINGS
    return JSON.stringify(draft) !== JSON.stringify(baseline) || draft.auto_record !== autoRecord
  }, [autoRecord, draft, settings])

  const transcriptsComplete = useMemo(
    () => meetings.filter((meeting) => meeting.transcription_status === 'complete').length,
    [meetings]
  )
  const failedTranscripts = useMemo(
    () => meetings.filter((meeting) => meeting.transcription_status === 'failed').length,
    [meetings]
  )
  const downloadedModels = useMemo(
    () => availableModels.filter((model) => model.downloaded),
    [availableModels]
  )
  const modelRuntime = useMemo(() => {
    if (downloadedModels.length === 0) return 'No local model yet'
    return `${downloadedModels.map((model) => model.name).join(', ')} local`
  }, [downloadedModels])
  const encryptionStatus = settings?.storage_path?.startsWith('/Users/')
    ? 'Managed by macOS disk encryption'
    : 'Storage path configured'

  const sectionMeta: Record<SettingsSectionId, { label: string; detail: string }> = {
    calendar: { label: 'Calendar', detail: 'Source and auto-record behavior.' },
    recording: { label: 'Recording', detail: 'Input device and audio capture.' },
    privacy: { label: 'Privacy', detail: 'Local-first, on-device processing.' },
    models: { label: 'Models', detail: 'Transcription models on this Mac.' },
    storage: { label: 'Storage', detail: 'Where data is written.' },
    shortcuts: { label: 'Shortcuts', detail: 'Global keyboard shortcuts.' },
    app: { label: 'App', detail: 'Appearance and launch.' },
    integrations: { label: 'Integrations', detail: 'Coming soon.' },
  }

  const sectionIcons: Record<SettingsSectionId, ReactNode> = {
    calendar: <RailCalendarIcon />,
    recording: <RailRecordIcon />,
    privacy: <RailPrivacyIcon />,
    models: <RailModelIcon />,
    storage: <RailStorageIcon />,
    shortcuts: <RailShortcutIcon />,
    app: <RailAppIcon />,
    integrations: <RailIntegrationsIcon />,
  }

  const updateDraft = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSaved(false)

    try {
      await api.saveSettings(draft)
      await setAutoRecordEnabled(draft.auto_record)
      const refreshedSettings = await api.getSettings()
      setSettings(refreshedSettings)
      setDraft(refreshedSettings)
      setAutoRecord(refreshedSettings.auto_record)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handlePickStoragePath = async () => {
    setPickingStoragePath(true)
    setError(null)

    try {
      const selectedPath = await api.pickStorageFolder(draft.storage_path)
      if (selectedPath) updateDraft('storage_path', selectedPath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to choose a storage folder')
    } finally {
      setPickingStoragePath(false)
    }
  }

  const refreshCleanupState = async () => {
    const [usage, preview] = await Promise.all([
      api.getStorageUsage(),
      api.previewCleanup(),
    ])
    setStorageUsage(usage)
    setCleanupPreview(preview)
  }

  const handlePreviewCleanup = async () => {
    setLoadingCleanup(true)
    setError(null)
    try {
      await refreshCleanupState()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to preview cleanup')
    } finally {
      setLoadingCleanup(false)
    }
  }

  const handleRunCleanup = async () => {
    setRunningCleanup(true)
    setError(null)
    setCleanupResult(null)
    try {
      const result = await api.runCleanupNow()
      setCleanupResult(result)
      await refreshCleanupState()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run cleanup')
    } finally {
      setRunningCleanup(false)
    }
  }

  const refreshAmbientStatus = async () => {
    const status = await api.getAmbientStatus()
    setAmbientStatus(status)
  }

  const handleAmbientToggle = async () => {
    setAmbientBusy(true)
    setError(null)
    try {
      if (ambientStatus?.active) {
        await api.stopAmbientCapture()
      } else {
        await api.startAmbientCapture(selectedProfileId)
      }
      await refreshAmbientStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle ambient capture')
    } finally {
      setAmbientBusy(false)
    }
  }

  const handleSaveLastAmbient = async () => {
    setAmbientBusy(true)
    setError(null)
    try {
      const meetingId = await api.saveLastAmbientSegment()
      await refreshAmbientStatus()
      if (!meetingId) {
        setError('There is no saved ambient segment yet.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save last ambient segment')
    } finally {
      setAmbientBusy(false)
    }
  }

  const handleTestMicrophone = async () => {
    setTestingMicrophone(true)
    setMicrophoneProbe(null)
    setError(null)

    try {
      const result = await api.testMicrophoneInput(draft.audio_input_device)
      setMicrophoneProbe(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to test microphone')
    } finally {
      setTestingMicrophone(false)
    }
  }

  const handleTestSystemAudio = async () => {
    setTestingSystemAudio(true)
    setSystemAudioProbe(null)
    setError(null)

    try {
      const result = await api.testSystemAudioInput()
      setSystemAudioProbe(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to test system-audio capture')
    } finally {
      setTestingSystemAudio(false)
    }
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'calendar':
        return (
          <SettingsBlock title="Auto-record">
            <div className="settings-card-stack">
              <Field label="Auto-record upcoming meetings">
                <ToggleButton
                  value={draft.auto_record}
                  onClick={() => updateDraft('auto_record', !draft.auto_record)}
                  onLabel="Enabled"
                  offLabel="Disabled"
                  description="Start scheduled recordings automatically."
                />
              </Field>

              <Field label="Warning time">
                <select
                  value={draft.pre_meeting_notice_seconds}
                  onChange={(e) => updateDraft('pre_meeting_notice_seconds', Number(e.target.value))}
                  className="settings-input"
                  style={inputStyles()}
                >
                  {NOTICE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </SettingsBlock>
        )
      case 'recording':
        return (
          <SettingsBlock title="Capture">
            <div className="settings-card-stack">
              <div className={`settings-capture-hero ${microphoneProbe && !microphoneProbe.detected_signal ? 'is-failed' : ''}`}>
                <div className="settings-capture-hero-head">
                  <div className="settings-capture-hero-icon">
                    <MicrophoneStatusIcon detectedSignal={microphoneProbe?.detected_signal ?? false} />
                  </div>
                  <div className="settings-capture-hero-copy">
                    <div className="settings-capture-hero-title">Microphone path</div>
                    <div className="settings-capture-hero-text">
                      Run this before recording. Speak during the test and look for movement here first.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleTestMicrophone}
                    disabled={testingMicrophone}
                    className="ghost-pill is-selected-pill settings-capture-test-button"
                  >
                    {testingMicrophone ? 'Listening...' : 'Test mic'}
                  </button>
                </div>

                <div className="settings-capture-hero-wave-wrap">
                  <TestWaveStrip
                    active={testingMicrophone}
                    failed={Boolean(microphoneProbe && !microphoneProbe.detected_signal)}
                    level={audioLevel}
                  />
                </div>

                {microphoneProbe ? (
                  <div className="settings-probe-card settings-probe-card-hero">
                    <MicrophoneStatusIcon detectedSignal={microphoneProbe.detected_signal} />
                    <div className="settings-probe-content">
                      <div className="settings-probe-title-row">
                        <span className="settings-probe-title">
                          {microphoneProbe.detected_signal ? 'Microphone ready' : 'Mic test failed'}
                        </span>
                        <span
                          className={`settings-probe-badge ${microphoneProbe.detected_signal ? 'is-ready' : 'is-warning'}`}
                        >
                          peak {microphoneProbe.peak_level.toFixed(3)}
                        </span>
                      </div>
                      <div className="settings-probe-copy">
                        {microphoneProbe.detected_signal
                          ? `${microphoneProbe.effective_input_device ?? 'Selected microphone'} is sending live signal to Memosa.`
                          : `${microphoneProbe.effective_input_device ?? 'Selected microphone'} did not send usable audio to Memosa during the test. Fix this before recording.`}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="settings-capture-hero-hint">
                    The waveform should feel alive while Memosa is listening. If this test fails, recording quality is not trustworthy yet.
                  </div>
                )}
              </div>

              <Field label="Audio input device">
                <select
                  value={draft.audio_input_device ?? ''}
                  onChange={(e) => updateDraft('audio_input_device', e.target.value || undefined)}
                  className="settings-input"
                  style={inputStyles()}
                >
                  <option value="">Default microphone</option>
                  {inputDevices.map((device) => (
                    <option key={device} value={device}>
                      {device}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Capture system audio" hint="Uses a loopback device such as BlackHole or another virtual input">
                <ToggleButton
                  value={draft.capture_system_audio}
                  onClick={() => updateDraft('capture_system_audio', !draft.capture_system_audio)}
                  onLabel="Enabled"
                  offLabel="Disabled"
                  description={draft.capture_system_audio ? 'Speaker output will be mixed into the capture path when available.' : 'Record microphone only.'}
                />
              </Field>


              <Field label="Ambient prototype">
                <ToggleButton
                  value={draft.ambient_mode.enabled}
                  onClick={() =>
                    updateDraft('ambient_mode', {
                      ...draft.ambient_mode,
                      enabled: !draft.ambient_mode.enabled,
                    })
                  }
                  onLabel="Enabled"
                  offLabel="Disabled"
                  description="Keeps ambient capture settings available for manual use during your chosen hours."
                />
              </Field>

              <div className="settings-grid-three">
                <Field label="Buffer minutes">
                  <select
                    value={draft.ambient_mode.buffer_minutes}
                    onChange={(e) =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        buffer_minutes: Number(e.target.value) as 15 | 30 | 60,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  >
                    <option value={15}>15</option>
                    <option value={30}>30</option>
                    <option value={60}>60</option>
                  </select>
                </Field>
                <Field label="Active from">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={draft.ambient_mode.active_start_hour}
                    onChange={(e) =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        active_start_hour: Number(e.target.value) || 0,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
                <Field label="Active until">
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={draft.ambient_mode.active_end_hour}
                    onChange={(e) =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        active_end_hour: Number(e.target.value) || 0,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
              </div>

              <Field label="Ambient inputs">
                <div className="settings-grid-two">
                  <ToggleButton
                    value={draft.ambient_mode.capture_microphone}
                    onClick={() =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        capture_microphone: !draft.ambient_mode.capture_microphone,
                      })
                    }
                    onLabel="Microphone on"
                    offLabel="Microphone off"
                    description="Use the microphone path during ambient capture."
                  />
                  <ToggleButton
                    value={draft.ambient_mode.capture_system_audio}
                    onClick={() =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        capture_system_audio: !draft.ambient_mode.capture_system_audio,
                      })
                    }
                    onLabel="System audio on"
                    offLabel="System audio off"
                    description="Prepare loopback capture for a later ambient iteration."
                  />
                </div>
              </Field>

              <div className="settings-grid-two">
                <Field label="Max daily storage (MB)">
                  <input
                    type="number"
                    min={128}
                    value={draft.ambient_mode.max_daily_storage_mb}
                    onChange={(e) =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        max_daily_storage_mb: Number(e.target.value) || 128,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
                <Field label="Save last hotkey">
                  <input
                    type="text"
                    value={draft.ambient_mode.save_hotkey}
                    onChange={(e) =>
                      updateDraft('ambient_mode', {
                        ...draft.ambient_mode,
                        save_hotkey: e.target.value,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
              </div>

              <Field label="Excluded apps" hint="Comma-separated app names">
                <input
                  type="text"
                  value={draft.ambient_mode.excluded_apps.join(', ')}
                  onChange={(e) =>
                    updateDraft('ambient_mode', {
                      ...draft.ambient_mode,
                      excluded_apps: e.target.value.split(',').map((value) => value.trim()).filter(Boolean),
                    })
                  }
                  className="settings-input"
                  style={inputStyles()}
                />
              </Field>

              <Field label="Speaker test">
                <div className="settings-note-card">
                  <div className="settings-inline-head">
                    <div>
                      <div className="settings-note-title">Verify the speaker loopback path</div>
                      <div className="settings-note-copy">
                        Memosa will play a short built-in sound and listen on the configured loopback input so it can confirm speaker capture is real.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleTestSystemAudio}
                      disabled={testingSystemAudio}
                      className="ghost-pill"
                    >
                      {testingSystemAudio ? 'Testing...' : 'Test speakers'}
                    </button>
                  </div>
                  {systemAudioProbe ? (
                    <div className="settings-probe-card">
                      <SpeakerStatusIcon detectedSignal={systemAudioProbe.detected_signal} />
                      <div className="settings-probe-content">
                        <div className="settings-probe-title-row">
                          <span className="settings-probe-title">
                            {systemAudioProbe.detected_signal ? 'Speaker capture ready' : 'Speaker capture failed'}
                          </span>
                          <span
                            className={`settings-probe-badge ${systemAudioProbe.detected_signal ? 'is-ready' : 'is-warning'}`}
                          >
                            peak {systemAudioProbe.peak_level.toFixed(3)}
                          </span>
                        </div>
                        <div className="settings-probe-copy">
                          {systemAudioProbe.detected_signal
                            ? `${systemAudioProbe.effective_input_device ?? 'Loopback input'} is carrying system sound into Memosa.`
                            : `${systemAudioProbe.effective_input_device ?? 'Loopback input'} did not carry the built-in test sound. The macOS output-to-loopback routing is still broken, so speaker recordings will be silent until that route works.`}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </Field>

              <Field label="System readiness">
                {loadingDiagnostics ? (
                  <div className="settings-card-stack">
                    <div className="skeleton" style={{ height: 72, borderRadius: 18 }} />
                    <div className="skeleton" style={{ height: 72, borderRadius: 18 }} />
                    <div className="skeleton" style={{ height: 72, borderRadius: 18 }} />
                  </div>
                ) : audioDiagnostics ? (
                  <div className="settings-card-stack">
                    <SystemCheck
                      label="ffmpeg"
                      tone={audioDiagnostics.ffmpeg_available ? 'ok' : 'warn'}
                      value={audioDiagnostics.ffmpeg_available ? 'Installed' : 'Missing'}
                      detail={
                        audioDiagnostics.ffmpeg_available
                          ? 'Recordings can be encoded to M4A for playback and transcription.'
                          : 'Install via Homebrew: brew install ffmpeg'
                      }
                    />
                    <SystemCheck
                      label="Microphone"
                      tone={audioDiagnostics.microphone_available ? 'ok' : 'warn'}
                      value={audioDiagnostics.effective_input_device ?? 'Unavailable'}
                      detail={
                        audioDiagnostics.input_device_error ??
                        (audioDiagnostics.using_fallback_input_device
                          ? `macOS defaults to ${audioDiagnostics.default_input_device ?? 'a virtual input'}, so Memosa is using ${audioDiagnostics.effective_input_device ?? audioDiagnostics.preferred_input_device ?? 'a physical microphone'} instead.`
                          : `Using ${audioDiagnostics.requested_input_device ? 'the selected' : 'the default'} input device.`)
                      }
                    />
                    <SystemCheck
                      label="System audio"
                      tone={draft.capture_system_audio && !audioDiagnostics.blackhole_available ? 'warn' : 'neutral'}
                      value={
                        draft.capture_system_audio
                          ? audioDiagnostics.blackhole_available ? 'Loopback ready' : 'Loopback missing'
                          : 'Disabled'
                      }
                      detail={
                        draft.capture_system_audio
                          ? audioDiagnostics.blackhole_available
                            ? 'Speaker output can be mixed into recordings.'
                            : 'Install or enable a loopback input to capture speaker audio on macOS.'
                          : 'Turn this on only when you need system sound in the recording.'
                      }
                    />
                  </div>
                ) : (
                  <div className="settings-note-copy">Diagnostics are unavailable right now.</div>
                )}
              </Field>
            </div>
          </SettingsBlock>
        )
      case 'privacy':
        return (
          <SettingsBlock title="Privacy">
            <div className="privacy-pillars">
              {PRIVACY_PILLARS.map((pillar) => (
                <div key={pillar} className="privacy-pillar-chip">
                  <span className="privacy-pillar-dot" aria-hidden="true" />
                  <span>{pillar}</span>
                </div>
              ))}
            </div>

            <div className="privacy-metrics-grid">
              <div className="privacy-metric-card">
                <div className="privacy-metric-label">Flow</div>
                <div className="privacy-metric-value">Local</div>
                <div className="privacy-metric-copy">Current runtime mode</div>
              </div>
              <div className="privacy-metric-card">
                <div className="privacy-metric-label">Storage</div>
                <div className="privacy-metric-value">{settings?.storage_path ?? 'Not configured'}</div>
                <div className="privacy-metric-copy">Archive folder</div>
              </div>
              <div className="privacy-metric-card">
                <div className="privacy-metric-label">Model runtime</div>
                <div className="privacy-metric-value">{modelRuntime}</div>
                <div className="privacy-metric-copy">Whisper on this Mac</div>
              </div>
              <div className="privacy-metric-card">
                <div className="privacy-metric-label">Encryption</div>
                <div className="privacy-metric-value">{encryptionStatus}</div>
              </div>
              <div className="privacy-metric-card">
                <div className="privacy-metric-label">Completed</div>
                <div className="privacy-metric-value">{String(transcriptsComplete)}</div>
                <div className="privacy-metric-copy">Transcripts</div>
              </div>
              <div className="privacy-metric-card">
                <div className="privacy-metric-label">Failed</div>
                <div className="privacy-metric-value">{String(failedTranscripts)}</div>
                <div className="privacy-metric-copy">Transcripts</div>
              </div>
            </div>

            <div className="settings-note-card">
              <div className="settings-note-title">Local Whisper models in Memosa</div>
              <div className="settings-note-copy">
                This app exposes four local Whisper sizes: tiny, base, small, and medium. They download onto this Mac and run locally, so recording data is not sent to the cloud or to a third-party transcription service in the current app flow.
              </div>
              <div className="settings-link-row">
                <button className="settings-link-pill" type="button" onClick={() => void api.openExternalUrl(WHISPER_REPO_URL)}>
                  <ExternalLinkIcon />
                  OpenAI Whisper repo
                </button>
                <button className="settings-link-pill" type="button" onClick={() => void api.openExternalUrl(WHISPER_MODEL_CARD_URL)}>
                  <ExternalLinkIcon />
                  Model card
                </button>
              </div>
            </div>

            <div className="privacy-trust-list">
              {PRIVACY_TRUST_SECTIONS.map((section) => (
                <article key={section.title} className="privacy-trust-item">
                  <div className="privacy-trust-title">{section.title}</div>
                  <div className="privacy-trust-copy">{section.body}</div>
                </article>
              ))}
            </div>
          </SettingsBlock>
        )
      case 'models':
        return (
          <>
            <SettingsBlock title="Transcription — Whisper" detail="Converts your recordings to text on this Mac. No audio is sent to the cloud.">
              <div className="settings-card-stack">
                <Field label="Default model" hint="Applied to new recordings">
                  <select
                    value={draft.default_model}
                    onChange={(e) => updateDraft('default_model', e.target.value as WhisperModel)}
                    className="settings-input"
                    style={inputStyles()}
                  >
                    {MODEL_OPTIONS.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                </Field>

                {availableModels.length === 0 ? (
                  <div className="settings-note-copy">Loading model list…</div>
                ) : (
                  availableModels.map((model) => {
                    const progress = modelProgress.get(model.name)
                    return (
                      <div key={model.name} className="settings-model-card">
                        <div className="settings-inline-head">
                          <div>
                            <div className="settings-model-title">{model.name}</div>
                            <div className="settings-model-copy">{model.size_mb} MB · {LOCAL_MODEL_NOTES[model.name]}</div>
                          </div>
                          <button
                            onClick={() => downloadModel(model.name)}
                            disabled={model.downloaded || progress != null}
                            className={`ghost-pill ${model.downloaded ? 'is-success-pill' : 'is-selected-pill'}`}
                          >
                            {model.downloaded ? <><CheckIcon />Local Ready</> : progress != null ? 'Downloading…' : 'Download'}
                          </button>
                        </div>
                        {progress != null && (
                          <div className="settings-progress-wrap">
                            <div className="settings-progress-track">
                              <div className="settings-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                            </div>
                            <div className="settings-progress-copy">{Math.round(progress * 100)}%</div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}

                <div className="settings-note-card">
                  <div className="settings-note-title">Runs entirely on this Mac</div>
                  <div className="settings-note-copy">
                    Whisper is an open-source speech recognition model by OpenAI. Four sizes are included: tiny (fastest), base, small, and medium (most accurate). Your audio never leaves your device.
                  </div>
                  <div className="settings-link-row">
                    <button className="settings-link-pill" type="button" onClick={() => void api.openExternalUrl(WHISPER_REPO_URL)}>
                      <ExternalLinkIcon />Whisper repo
                    </button>
                    <button className="settings-link-pill" type="button" onClick={() => void api.openExternalUrl(WHISPER_MODEL_CARD_URL)}>
                      <ExternalLinkIcon />Model card
                    </button>
                  </div>
                </div>
              </div>
            </SettingsBlock>

          </>
        )
      case 'storage':
        return (
          <SettingsBlock title="Archive location">
            <div className="settings-card-stack">
              <Field label="Storage path" hint="Meeting audio, transcript files, and metadata folders">
                <div className="settings-inline-input">
                  <input
                    type="text"
                    value={draft.storage_path}
                    onChange={(e) => updateDraft('storage_path', e.target.value)}
                    className="settings-input"
                    style={inputStyles()}
                  />
                  <button
                    type="button"
                    onClick={handlePickStoragePath}
                    disabled={pickingStoragePath}
                    className="ghost-pill"
                  >
                    {pickingStoragePath ? 'Browsing...' : 'Browse'}
                  </button>
                </div>
              </Field>

              <div className="settings-grid-two">
                <div className="settings-check">
                  <div className="settings-check-row">
                    <div className="settings-check-label">Archive size</div>
                    <span className="settings-check-tone is-neutral">{formatBytes(storageUsage?.total_bytes ?? 0)}</span>
                  </div>
                  <div className="settings-check-copy">
                    {storageUsage?.meeting_count ?? 0} live recordings, {formatBytes(storageUsage?.archive_bytes ?? 0)} already archived.
                  </div>
                </div>
                <div className="settings-check">
                  <div className="settings-check-row">
                    <div className="settings-check-label">Reclaimable now</div>
                    <span className="settings-check-tone is-warn">{formatBytes(cleanupPreview?.total_bytes_reclaimable ?? 0)}</span>
                  </div>
                  <div className="settings-check-copy">
                    {cleanupPreview?.candidates.length ?? 0} cleanup candidates in the current policy preview.
                  </div>
                </div>
              </div>

              <Field label="Retention policy">
                <ToggleButton
                  value={draft.retention_policy.enabled}
                  onClick={() =>
                    updateDraft('retention_policy', {
                      ...draft.retention_policy,
                      enabled: !draft.retention_policy.enabled,
                    })
                  }
                  onLabel="Enabled"
                  offLabel="Disabled"
                  description="Preview and clean older recordings and transcripts automatically when you choose."
                />
              </Field>

              <div className="settings-grid-three">
                <Field label="Archive after days">
                  <input
                    type="number"
                    min={1}
                    value={draft.retention_policy.archive_after_days}
                    onChange={(e) =>
                      updateDraft('retention_policy', {
                        ...draft.retention_policy,
                        archive_after_days: Number(e.target.value) || 1,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
                <Field label="Delete audio after days">
                  <input
                    type="number"
                    min={1}
                    value={draft.retention_policy.recordings_delete_after_days}
                    onChange={(e) =>
                      updateDraft('retention_policy', {
                        ...draft.retention_policy,
                        recordings_delete_after_days: Number(e.target.value) || 1,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
                <Field label="Delete transcripts after days">
                  <input
                    type="number"
                    min={1}
                    value={draft.retention_policy.transcripts_delete_after_days}
                    onChange={(e) =>
                      updateDraft('retention_policy', {
                        ...draft.retention_policy,
                        transcripts_delete_after_days: Number(e.target.value) || 1,
                      })
                    }
                    className="settings-input"
                    style={inputStyles()}
                  />
                </Field>
              </div>

              <Field label="Keep profiles" hint="Comma-separated profile ids protected from cleanup">
                <input
                  type="text"
                  value={draft.retention_policy.keep_profiles.join(', ')}
                  onChange={(e) =>
                    updateDraft('retention_policy', {
                      ...draft.retention_policy,
                      keep_profiles: e.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })
                  }
                  className="settings-input"
                  style={inputStyles()}
                />
              </Field>

              <div className="settings-inline-actions">
                <button type="button" className="ghost-pill" onClick={handlePreviewCleanup} disabled={loadingCleanup}>
                  {loadingCleanup ? 'Refreshing…' : 'Preview cleanup'}
                </button>
                <button type="button" className="ghost-pill" onClick={handleRunCleanup} disabled={runningCleanup || !draft.retention_policy.enabled}>
                  {runningCleanup ? 'Cleaning…' : 'Run cleanup now'}
                </button>
              </div>

              {cleanupResult ? (
                <div className="settings-note-card">
                  <div className="settings-note-title">Last cleanup run</div>
                  <div className="settings-note-copy">
                    Archived {cleanupResult.archived}, deleted {cleanupResult.transcripts_deleted} transcripts, removed {cleanupResult.meetings_deleted} meetings, reclaimed {formatBytes(cleanupResult.reclaimed_bytes)}.
                  </div>
                </div>
              ) : null}

              {cleanupPreview?.candidates.length ? (
                <div className="settings-card-stack">
                  {cleanupPreview.candidates.slice(0, 6).map((candidate) => (
                    <div key={`${candidate.meeting_id}-${candidate.action}`} className="settings-check">
                      <div className="settings-check-row">
                        <div className="settings-check-label">{candidate.title}</div>
                        <span className="settings-check-tone is-neutral">{candidate.action.replace('_', ' ')}</span>
                      </div>
                      <div className="settings-check-copy">
                        {candidate.date} · {candidate.reason} · {formatBytes(candidate.bytes_reclaimable)}
                      </div>
                    </div>
                  ))}
                  {cleanupPreview.candidates.length > 6 ? (
                    <div className="settings-note-copy">
                      {cleanupPreview.candidates.length - 6} more candidates in this preview.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="settings-note-copy">
                  No cleanup candidates in the current archive or the policy is disabled.
                </div>
              )}
            </div>
          </SettingsBlock>
        )
      case 'shortcuts':
        return (
          <SettingsBlock title="Shortcuts">
            <div className="settings-card-stack">
              <Field label="Start or stop recording">
                <input
                  type="text"
                  value={hotkeys.start_stop_recording}
                  onChange={(e) => setHotkeys({ ...hotkeys, start_stop_recording: e.target.value })}
                  className="settings-input"
                  style={inputStyles()}
                />
              </Field>
              <Field label="Open command palette">
                <input
                  type="text"
                  value={hotkeys.open_command_palette}
                  onChange={(e) => setHotkeys({ ...hotkeys, open_command_palette: e.target.value })}
                  className="settings-input"
                  style={inputStyles()}
                />
              </Field>
              <div className="settings-note-copy">
                Active commands today: recording toggle and command palette.
              </div>
            </div>
          </SettingsBlock>
        )
      case 'app':
        return (
          <SettingsBlock title="Appearance">
            <div className="settings-card-stack">
              <Field label="Appearance">
                <select
                  value={draft.appearance_mode}
                  onChange={(e) => updateDraft('appearance_mode', e.target.value as AppSettings['appearance_mode'])}
                  className="settings-input"
                  style={inputStyles()}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="system">System</option>
                </select>
              </Field>
              <Field label="Launch at login">
                <ToggleButton
                  value={draft.launch_at_login}
                  onClick={() => updateDraft('launch_at_login', !draft.launch_at_login)}
                  onLabel="Enabled"
                  offLabel="Disabled"
                  description="Open Memosa automatically when you sign in to macOS."
                />
              </Field>
            </div>
          </SettingsBlock>
        )

      case 'integrations':
        return (
          <SettingsBlock title="Integrations">
            <div className="settings-note-card" style={{ marginBottom: 20 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--accent)' }}>Coming Soon</span>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Integrations are in development. Export recordings to your tools automatically once enabled.
              </p>
            </div>
            <div className="settings-card-stack" style={{ opacity: 0.45, pointerEvents: 'none' }}>
              {[
                { name: 'Google Drive', detail: 'Export audio and transcripts to Drive' },
                { name: 'Notion', detail: 'Push summaries and notes to Notion pages' },
                { name: 'Obsidian', detail: 'Write markdown notes to your vault' },
                { name: 'Dropbox', detail: 'Sync recordings to Dropbox' },
                { name: 'Webhook', detail: 'Send events to any HTTP endpoint' },
                { name: 'NotebookLM', detail: 'Feed transcripts to Google NotebookLM' },
              ].map((item) => (
                <div key={item.name} className="settings-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.detail}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
                    Soon
                  </div>
                </div>
              ))}
            </div>
          </SettingsBlock>
        )
    }
  }

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="settings-scene" onClick={(event) => event.stopPropagation()}>
      <div className="settings-sheet">
        <aside className="settings-rail">
            <div className="settings-rail-top">
              <div className="settings-modal-eyebrow">Settings</div>
              <div className="settings-rail-title">Configuration</div>
              <div className="settings-rail-copy">
                Keep the controls grouped and local-first.
              </div>
            </div>

          <nav className="settings-rail-nav">
              {SECTION_ORDER.map((sectionId) => (
                <button
                  key={sectionId}
                  className={`settings-rail-item ${activeSection === sectionId ? 'is-active' : ''}`}
                  onClick={() => setActiveSection(sectionId)}
                >
                  <span className="settings-rail-item-icon">{sectionIcons[sectionId]}</span>
                  <span>{sectionMeta[sectionId].label}</span>
                </button>
              ))}
          </nav>

          <div className="settings-rail-footer">
            <button className="ghost-pill" onClick={() => setActiveView('today')}>
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="ghost-pill is-selected-pill"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </aside>

          <section className="settings-content">
            <div className="settings-content-header">
              <div>
                <h1 className="settings-content-title">{sectionMeta[activeSection].label}</h1>
                <p className="settings-content-copy" style={{ marginTop: 2 }}>{sectionMeta[activeSection].detail}</p>
              </div>
            <div className="settings-status-stack">
              {saved && !error ? <div className="settings-inline-badge is-success">Saved</div> : null}
              {isDirty ? <div className="settings-inline-badge is-pending">Unsaved</div> : null}
            </div>
          </div>

          {error ? (
            <div className="settings-message is-error">{error}</div>
          ) : null}

            <div className="settings-content-scroll">
              {renderSection()}
            </div>
          </section>
      </div>
    </div>
    </div>
  )
}
