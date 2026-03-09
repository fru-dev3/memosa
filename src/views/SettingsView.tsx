import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useCalendar } from '../hooks/useCalendar'
import { useTranscription } from '../hooks/useTranscription'
import { VoiceMemosImport } from '../components/settings/VoiceMemosImport'
import * as api from '../lib/tauri'
import type {
  AppSettings,
  AudioDiagnostics,
  CleanupLogEntry,
  CleanupPreview,
  CleanupRunResult,
  MicrophoneProbeResult,
  RecordingProfile,
  StorageUsage,
  WhisperModel,
} from '../lib/types'
import { useMemosaStore } from '../store'

// ─── Constants ───────────────────────────────────────────────────────────────

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
  summary_template_prompts: {},
  custom_summary_templates: [],
  excluded_calendar_names: [],
  has_completed_setup: false,
}

const MODEL_OPTIONS: WhisperModel[] = ['tiny', 'base', 'small', 'medium']
const MODEL_NOTES: Record<WhisperModel, string> = {
  tiny: 'Fastest',
  base: 'Balanced',
  small: 'Better accuracy',
  medium: 'Best accuracy',
}
const NOTICE_OPTIONS = [
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
]
const WHISPER_REPO_URL = 'https://github.com/openai/whisper'

// ─── Small SVG icons ──────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6.25L4.6 8.85L10 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4 2.25H9.75V8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2.5L2.25 9.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

// ─── Layout atoms ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--text-muted)', padding: '20px 0 2px' }}>
      {children}
    </div>
  )
}

function Row({
  label,
  hint,
  children,
  borderless,
  alignTop,
}: {
  label: string
  hint?: string
  children: ReactNode
  borderless?: boolean
  alignTop?: boolean
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: alignTop ? 'flex-start' : 'center',
      gap: 16,
      padding: '10px 0',
      borderBottom: borderless ? 'none' : '1px solid var(--border-subtle)',
    }}>
      <div style={{ flex: '0 0 44%', paddingTop: alignTop ? 3 : 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        border: '1px solid var(--settings-input-border)',
        background: 'var(--settings-input-bg)',
        borderRadius: 10,
        padding: '6px 10px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontSize: 12,
        color: value ? 'var(--accent)' : 'var(--text-muted)',
        fontWeight: 500,
      }}
    >
      {label && <span>{value ? label : 'Off'}</span>}
      <span style={{
        width: 32,
        height: 18,
        borderRadius: 999,
        background: value ? 'var(--accent)' : 'var(--border)',
        position: 'relative',
        transition: 'background 180ms',
        flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute',
          top: 2,
          left: value ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: 999,
          background: '#fff',
          transition: 'left 180ms',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </span>
    </button>
  )
}

function Inp({ value, onChange, type = 'text', style }: {
  value: string | number
  onChange: (v: string) => void
  type?: string
  style?: React.CSSProperties
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="settings-input"
      style={{
        background: 'var(--settings-input-bg)',
        border: '1px solid var(--settings-input-border)',
        color: 'var(--text-primary)',
        fontSize: 12,
        padding: '6px 10px',
        borderRadius: 8,
        fontFamily: 'inherit',
        ...style,
      }}
    />
  )
}

function Sel({ value, onChange, children, style }: {
  value: string | number
  onChange: (v: string) => void
  children: ReactNode
  style?: React.CSSProperties
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="settings-input"
      style={{
        background: 'var(--settings-input-bg)',
        border: '1px solid var(--settings-input-border)',
        color: 'var(--text-primary)',
        fontSize: 12,
        padding: '6px 10px',
        borderRadius: 8,
        fontFamily: 'inherit',
        ...style,
      }}
    >
      {children}
    </select>
  )
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const v = bytes / 1024 ** exp
  return `${v >= 10 || exp === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[exp]}`
}

function initialsFor(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'P'
}

function toggleTag(tags: string[], value: string) {
  return tags.includes(value) ? tags.filter((t) => t !== value) : [...tags, value]
}

// ─── Mic test wave strip ──────────────────────────────────────────────────────

function WaveStrip({ active, level }: { active: boolean; level: number }) {
  const shaped = active ? Math.min(1, Math.max(0, level * 9)) : 0
  return (
    <div className={`settings-test-wave ${active ? 'is-active' : ''}`} style={{ margin: '8px 0' }}>
      {Array.from({ length: 22 }, (_, i) => (
        <span
          key={i}
          className="settings-test-wave-bar"
          style={{ animationDelay: `${i * 70}ms`, ['--wave-level' as string]: String(shaped) }}
        />
      ))}
    </div>
  )
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'capture' | 'transcription' | 'storage' | 'profiles' | 'import'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'capture',       label: 'Capture',       icon: '🎙️' },
  { id: 'transcription', label: 'Transcription',  icon: '✦' },
  { id: 'storage',       label: 'Storage',        icon: '🗂️' },
  { id: 'profiles',      label: 'Profiles',       icon: '👤' },
  { id: 'import',        label: 'Import',         icon: '📥' },
]

// ─── Hotkey badge (read-only) ─────────────────────────────────────────────────

function HotkeyBadge({ value }: { value: string }) {
  return (
    <span style={{
      display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
    }}>
      {value.split('+').map((part) => (
        <kbd key={part} style={{
          padding: '2px 7px', borderRadius: 6, fontSize: 12,
          background: 'var(--settings-input-bg)',
          border: '1px solid var(--settings-input-border)',
          color: 'var(--text-primary)',
          fontFamily: 'inherit', letterSpacing: '0.2px',
        }}>{part}</kbd>
      ))}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SettingsView() {
  const { autoRecord, setAutoRecordEnabled } = useCalendar()
  const {
    availableModels,
    hotkeys,
    meetings,
    profiles,
    selectedProfileId,
    setActiveView,
    folders,
    meetingFolderAssignments,
    setAutoRecord,
    setAvailableModels,
    setSelectedProfileId,
    setSettings,
    settings,
    todayEvents,
    screenshotCaptureEnabled,
    screenshotIntervalMinutes,
    setScreenshotCaptureEnabled,
    setScreenshotIntervalMinutes,
    createProfile,
    deleteProfile,
    updateProfile,
  } = useMemosaStore()
  const { downloadModel, modelProgress } = useTranscription()

  const hasModel = availableModels.some((m) => m.downloaded)
  const [tab, setTab] = useState<Tab>(hasModel ? 'capture' : 'transcription')
  const [draft, setDraft] = useState<AppSettings>(settings ?? DEFAULT_SETTINGS)
  const draftRef = useRef<AppSettings>(draft)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [audioDiagnostics, setAudioDiagnostics] = useState<AudioDiagnostics | null>(null)
  const [inputDevices, setInputDevices] = useState<string[]>([])
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(true)
  const [testingMic, setTestingMic] = useState(false)
  const [micProbe, setMicProbe] = useState<MicrophoneProbeResult | null>(null)
  const [testingSystem, setTestingSystem] = useState(false)
  const [systemProbe, setSystemProbe] = useState<MicrophoneProbeResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickingPath, setPickingPath] = useState(false)
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null)
  const [cleanupResult, setCleanupResult] = useState<CleanupRunResult | null>(null)
  const [cleanupLog, setCleanupLog] = useState<CleanupLogEntry[]>([])
  const [loadingCleanup, setLoadingCleanup] = useState(false)
  const [runningCleanup, setRunningCleanup] = useState(false)
  const audioLevel = useMemosaStore((s) => s.audioLevel)
  const [migrating, setMigrating] = useState(false)
  const [migrationDone, setMigrationDone] = useState(false)

  useEffect(() => {
    setDraft(settings ?? DEFAULT_SETTINGS)
    draftRef.current = settings ?? DEFAULT_SETTINGS
  }, [settings])

  useEffect(() => {
    api.getInputDevices().then(setInputDevices).catch(() => {})
    if (availableModels.length === 0) {
      api.getAvailableModels().then(setAvailableModels).catch(() => {})
    }
    api.getStorageUsage().then(setStorageUsage).catch(() => {})
    api.previewCleanup().then(setCleanupPreview).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    setLoadingDiagnostics(true)
    api.getAudioDiagnostics(draft.audio_input_device, draft.capture_system_audio)
      .then((d) => { if (!cancelled) setAudioDiagnostics(d) })
      .catch(() => { if (!cancelled) setAudioDiagnostics(null) })
      .finally(() => { if (!cancelled) setLoadingDiagnostics(false) })
    return () => { cancelled = true }
  }, [draft.audio_input_device, draft.capture_system_audio])

  const doSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.saveSettings(draftRef.current)
      await setAutoRecordEnabled(draftRef.current.auto_record)
      const refreshed = await api.getSettings()
      setSettings(refreshed)
      setDraft(refreshed)
      draftRef.current = refreshed
      setAutoRecord(refreshed.auto_record)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [setAutoRecord, setAutoRecordEnabled, setSettings])

  const updateDraft = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...draftRef.current, [key]: value }
    draftRef.current = next
    setDraft(next)
    setSaved(false)
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => { void doSave() }, 900)
  }, [doSave])

  const updateRetention = useCallback(<K extends keyof AppSettings['retention_policy']>(key: K, value: AppSettings['retention_policy'][K]) => {
    updateDraft('retention_policy', { ...draftRef.current.retention_policy, [key]: value })
  }, [updateDraft])

  const refreshCleanup = async () => {
    const [usage, preview, log] = await Promise.all([
      api.getStorageUsage(),
      api.previewCleanup(),
      api.getCleanupLog().catch(() => [] as CleanupLogEntry[]),
    ])
    setStorageUsage(usage)
    setCleanupPreview(preview)
    setCleanupLog(log)
  }

  const handlePreviewCleanup = async () => {
    setLoadingCleanup(true)
    try { await refreshCleanup() }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to preview cleanup') }
    finally { setLoadingCleanup(false) }
  }

  const handleRunCleanup = async () => {
    setRunningCleanup(true)
    setCleanupResult(null)
    try {
      const result = await api.runCleanupNow()
      setCleanupResult(result)
      await refreshCleanup()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run cleanup')
    } finally {
      setRunningCleanup(false)
    }
  }

  const handleTestMic = async () => {
    setTestingMic(true)
    setMicProbe(null)
    try {
      const r = await api.testMicrophoneInput(draft.audio_input_device)
      setMicProbe(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mic test failed')
    } finally {
      setTestingMic(false)
    }
  }

  const handleTestSystem = async () => {
    setTestingSystem(true)
    setSystemProbe(null)
    try {
      const r = await api.testSystemAudioInput()
      setSystemProbe(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speaker test failed')
    } finally {
      setTestingSystem(false)
    }
  }

  const handlePickPath = async () => {
    setPickingPath(true)
    try {
      const p = await api.pickStorageFolder(draft.storage_path)
      if (p) updateDraft('storage_path', p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pick folder')
    } finally {
      setPickingPath(false)
    }
  }

  const handleMigrateToDefault = async () => {
    setMigrating(true)
    try {
      const all = await api.getMeetings({})
      for (const m of all) await api.updateMeetingProfile(m.id, 'default')
      setMigrationDone(true)
    } finally {
      setMigrating(false)
    }
  }

  const activeProfile = profiles.find((p) => p.id === selectedProfileId) ?? profiles[0]
  const isDefaultProfile = activeProfile?.id === 'default'

  const updateActiveProfile = <K extends keyof RecordingProfile>(key: K, value: RecordingProfile[K]) => {
    if (activeProfile) updateProfile(activeProfile.id, { [key]: value } as Partial<RecordingProfile>)
  }

  const downloadedModels = useMemo(() => availableModels.filter((m) => m.downloaded), [availableModels])

  const calendarNames = useMemo(
    () => Array.from(new Set(todayEvents.map((e) => e.calendar_name).filter(Boolean))).sort(),
    [todayEvents]
  )

  // ── Tab content renderers ──────────────────────────────────────────────────

  function renderCapture() {
    return (
      <>
        <SectionLabel>Microphone</SectionLabel>

        <Row label="Input device" borderless={false}>
          <Sel
            value={draft.audio_input_device ?? ''}
            onChange={(v) => updateDraft('audio_input_device', v || undefined)}
            style={{ minWidth: 180 }}
          >
            <option value="">Default</option>
            {inputDevices.map((d) => <option key={d} value={d}>{d}</option>)}
          </Sel>
        </Row>

        <Row label="System audio" hint="Requires BlackHole or a loopback device">
          <Toggle value={draft.capture_system_audio} onChange={(v) => updateDraft('capture_system_audio', v)} label="On" />
        </Row>

        <Row label="Test microphone" borderless>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, width: '100%' }}>
            <button
              type="button"
              className="ghost-pill is-selected-pill"
              onClick={() => void handleTestMic()}
              disabled={testingMic}
            >
              {testingMic ? 'Listening…' : 'Test mic'}
            </button>
            {(testingMic || micProbe) && (
              <div style={{ width: '100%' }}>
                <WaveStrip active={testingMic} level={audioLevel} />
                {micProbe && (
                  <div style={{ fontSize: 11, color: micProbe.detected_signal ? '#22c55e' : '#f87171', marginTop: 4 }}>
                    {micProbe.detected_signal
                      ? `Ready — peak ${micProbe.peak_level.toFixed(3)}`
                      : `No signal — peak ${micProbe.peak_level.toFixed(3)}`}
                  </div>
                )}
              </div>
            )}
          </div>
        </Row>

        {!loadingDiagnostics && audioDiagnostics && (
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            {[
              {
                label: 'ffmpeg',
                ok: audioDiagnostics.ffmpeg_available,
                note: audioDiagnostics.ffmpeg_available ? 'Installed' : 'brew install ffmpeg',
              },
              {
                label: 'Mic',
                ok: audioDiagnostics.microphone_available,
                note: audioDiagnostics.effective_input_device ?? 'Unavailable',
              },
              {
                label: 'Loopback',
                ok: !draft.capture_system_audio || audioDiagnostics.blackhole_available,
                note: !draft.capture_system_audio ? 'Disabled' : audioDiagnostics.blackhole_available ? 'Ready' : 'Not found',
              },
            ].map(({ label, ok, note }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                <span style={{ width: 70, color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
                <span style={{ color: ok ? '#22c55e' : '#f87171', flexShrink: 0 }}>{ok ? '✓' : '!'}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{note}</span>
              </div>
            ))}
            {audioDiagnostics.blackhole_available === false && draft.capture_system_audio && (
              <button
                type="button"
                className="ghost-pill"
                style={{ marginTop: 6 }}
                onClick={() => void handleTestSystem()}
                disabled={testingSystem}
              >
                {testingSystem ? 'Testing…' : 'Test speakers'}
              </button>
            )}
            {systemProbe && (
              <div style={{ fontSize: 11, color: systemProbe.detected_signal ? '#22c55e' : '#f87171', marginTop: 4 }}>
                {systemProbe.detected_signal ? 'Speaker capture ready' : 'Speaker capture failed — check loopback routing'}
              </div>
            )}
          </div>
        )}

        <SectionLabel>Screenshots</SectionLabel>

        <Row label="Auto-capture" hint="Takes a screenshot at regular intervals during recording">
          <Toggle value={screenshotCaptureEnabled} onChange={setScreenshotCaptureEnabled} label="On" />
        </Row>

        {screenshotCaptureEnabled && (
          <Row label="Interval" borderless>
            <div style={{ display: 'flex', gap: 5 }}>
              {[1, 2, 5, 10].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setScreenshotIntervalMinutes(m)}
                  className={`ghost-pill${screenshotIntervalMinutes === m ? ' is-selected-pill' : ''}`}
                  style={{ minWidth: 40, textAlign: 'center' }}
                >
                  {m}m
                </button>
              ))}
            </div>
          </Row>
        )}

        <SectionLabel>Auto-record</SectionLabel>

        <Row label="Auto-record meetings" hint="Starts recording automatically when a calendar event begins">
          <Toggle value={draft.auto_record} onChange={(v) => updateDraft('auto_record', v)} label="On" />
        </Row>

        {draft.auto_record && (
          <Row label="Lead time">
            <Sel value={draft.pre_meeting_notice_seconds} onChange={(v) => updateDraft('pre_meeting_notice_seconds', Number(v))}>
              {NOTICE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Sel>
          </Row>
        )}

        {calendarNames.length > 0 && (
          <>
            <SectionLabel>Calendar sources</SectionLabel>
            {calendarNames.map((name, i) => {
              const excluded = (draft.excluded_calendar_names ?? []).includes(name)
              return (
                <Row key={name} label={name} borderless={i === calendarNames.length - 1}>
                  <button
                    type="button"
                    className={`ghost-pill ${excluded ? '' : 'is-selected-pill'}`}
                    onClick={() => {
                      const cur = draft.excluded_calendar_names ?? []
                      const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]
                      updateDraft('excluded_calendar_names', next)
                    }}
                  >
                    {excluded ? 'Hidden' : 'Shown'}
                  </button>
                </Row>
              )
            })}
          </>
        )}

        <SectionLabel>Hotkeys</SectionLabel>

        <Row label="Start / stop recording">
          <HotkeyBadge value={hotkeys.start_stop_recording} />
        </Row>

        <Row label="Command palette" borderless>
          <HotkeyBadge value={hotkeys.open_command_palette} />
        </Row>
      </>
    )
  }

  function renderTranscription() {
    return (
      <>
        <SectionLabel>Model</SectionLabel>

        <Row label="Default model" hint="Used for all transcriptions on this Mac">
          <Sel value={draft.default_model} onChange={(v) => updateDraft('default_model', v as WhisperModel)}>
            {MODEL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Sel>
        </Row>

        {downloadedModels.length === 0 && (
          <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--text-muted)' }}>
            No model downloaded yet. Download one below.
          </div>
        )}

        <SectionLabel>Local models</SectionLabel>

        {availableModels.length === 0 ? (
          <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--text-muted)' }}>Loading…</div>
        ) : (
          availableModels.map((model, i) => {
            const progress = modelProgress.get(model.name)
            return (
              <div key={model.name} style={{ padding: '10px 0', borderBottom: i < availableModels.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {model.name}
                      {model.name === draft.default_model && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>active</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {model.size_mb} MB · {MODEL_NOTES[model.name]}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {model.downloaded && (
                      <button
                        className="ghost-pill"
                        onClick={() => void api.deleteModel(model.name).then(() => api.getAvailableModels().then(setAvailableModels))}
                      >
                        Delete
                      </button>
                    )}
                    <button
                      onClick={() => downloadModel(model.name)}
                      disabled={model.downloaded || progress != null}
                      className={`ghost-pill ${model.downloaded ? 'is-success-pill' : 'is-selected-pill'}`}
                    >
                      {model.downloaded ? <><CheckIcon /> Ready</> : progress != null ? `${Math.round(progress * 100)}%` : 'Download'}
                    </button>
                  </div>
                </div>
                {progress != null && (
                  <div style={{ marginTop: 6, height: 3, background: 'var(--border-subtle)', borderRadius: 99 }}>
                    <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: 'var(--accent)', borderRadius: 99, transition: 'width 200ms' }} />
                  </div>
                )}
              </div>
            )
          })
        )}

        <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          <button className="ghost-pill" onClick={() => void api.openExternalUrl(WHISPER_REPO_URL)}>
            <ExternalLinkIcon /> Whisper repo
          </button>
        </div>
      </>
    )
  }

  function renderStorage() {
    const total = storageUsage?.total_bytes ?? 0
    const segments = total > 0 ? [
      { label: 'Audio', bytes: storageUsage!.audio_bytes, color: 'var(--accent)' },
      { label: 'Transcripts', bytes: storageUsage!.transcript_bytes, color: '#22c55e' },
      { label: 'Archive', bytes: storageUsage!.archive_bytes, color: '#f59e0b' },
      { label: 'Metadata', bytes: storageUsage!.metadata_bytes, color: '#a78bfa' },
      { label: 'Other', bytes: storageUsage!.other_bytes, color: 'var(--border-subtle)' },
    ].filter((s) => s.bytes > 0) : []

    return (
      <>
        <SectionLabel>Archive location</SectionLabel>

        <Row label="Storage path" hint="Audio, transcripts, and metadata are written here" alignTop>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Inp
              value={draft.storage_path}
              onChange={(v) => updateDraft('storage_path', v)}
              style={{ width: 220, fontSize: 11 }}
            />
            <button type="button" className="ghost-pill" onClick={() => void handlePickPath()} disabled={pickingPath}>
              {pickingPath ? '…' : 'Browse'}
            </button>
          </div>
        </Row>

        {segments.length > 0 && (
          <div style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', height: 6, borderRadius: 4, overflow: 'hidden', gap: 1, marginBottom: 6 }}>
              {segments.map((s) => (
                <div key={s.label} title={`${s.label}: ${formatBytes(s.bytes)}`} style={{ flex: s.bytes / total, background: s.color, minWidth: 2 }} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
              {segments.map((s) => (
                <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  {s.label} <span style={{ color: 'var(--text-muted)' }}>{formatBytes(s.bytes)}</span>
                </span>
              ))}
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
                {storageUsage?.meeting_count ?? 0} memos · {formatBytes(total)} total
              </span>
            </div>
          </div>
        )}

        {/* Per-collection storage breakdown */}
        {(() => {
          const meetingMap = new Map(meetings.map(m => [m.id, m]))
          const folderStats = folders.map(folder => {
            const meetingIds = Object.entries(meetingFolderAssignments)
              .filter(([, fids]) => fids.includes(folder.id))
              .map(([mid]) => mid)
            const folderMeetings = meetingIds.map(id => meetingMap.get(id)).filter(Boolean) as typeof meetings
            const memoCount = folderMeetings.length
            const totalDuration = folderMeetings.reduce((sum, m) => sum + m.duration_seconds, 0)
            const starredCount = folderMeetings.filter(m => m.is_favorite).length
            // Approximate: audio ~600 bytes/sec, transcript ~17 bytes/sec, metadata ~1KB
            const estimatedBytes = totalDuration * 617 + memoCount * 1024
            return { id: folder.id, name: folder.name, color: folder.color, memoCount, totalDuration, starredCount, estimatedBytes }
          }).filter(f => f.memoCount > 0).sort((a, b) => b.estimatedBytes - a.estimatedBytes)

          // Count unassigned memos
          const assignedIds = new Set(Object.keys(meetingFolderAssignments).filter(
            mid => meetingFolderAssignments[mid].length > 0
          ))
          const unassignedCount = meetings.length - assignedIds.size

          if (folderStats.length === 0 && unassignedCount === 0) return null

          return (
            <>
              <SectionLabel>Usage by collection</SectionLabel>
              <div style={{ padding: '4px 0 8px', borderBottom: '1px solid var(--border-subtle)' }}>
                {folderStats.map(f => (
                  <div key={f.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 0', fontSize: 12,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: f.color || 'var(--text-muted)', flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 500 }}>
                      {f.name}
                    </span>
                    {f.starredCount > 0 && (
                      <span style={{ fontSize: 10, color: '#d97706' }}>
                        {f.starredCount} starred
                      </span>
                    )}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 60 }}>
                      {f.memoCount} memo{f.memoCount !== 1 ? 's' : ''}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 55, textAlign: 'right' }}>
                      ~{formatBytes(f.estimatedBytes)}
                    </span>
                  </div>
                ))}
                {unassignedCount > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 0', fontSize: 12,
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: 'var(--border)', flexShrink: 0,
                    }} />
                    <span style={{ flex: 1, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      Unassigned
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 60 }}>
                      {unassignedCount} memo{unassignedCount !== 1 ? 's' : ''}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 55, textAlign: 'right' }} />
                  </div>
                )}
              </div>
            </>
          )
        })()}

        <SectionLabel>Retention</SectionLabel>

        <Row label="Auto-cleanup" hint="Archive or delete older recordings on a schedule">
          <Toggle value={draft.retention_policy.enabled} onChange={(v) => updateRetention('enabled', v)} label="On" />
        </Row>

        {draft.retention_policy.enabled && (
          <>
            <Row label="Archive after">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Inp
                  value={draft.retention_policy.archive_after_days}
                  onChange={(v) => updateRetention('archive_after_days', Number(v) || 1)}
                  type="number"
                  style={{ width: 60, textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days</span>
              </div>
            </Row>
            <Row label="Delete audio after">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Inp
                  value={draft.retention_policy.recordings_delete_after_days}
                  onChange={(v) => updateRetention('recordings_delete_after_days', Number(v) || 1)}
                  type="number"
                  style={{ width: 60, textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days</span>
              </div>
            </Row>
            <Row label="Delete transcripts after" borderless>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Inp
                  value={draft.retention_policy.transcripts_delete_after_days}
                  onChange={(v) => updateRetention('transcripts_delete_after_days', Number(v) || 1)}
                  type="number"
                  style={{ width: 60, textAlign: 'center' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>days</span>
              </div>
            </Row>
          </>
        )}

        <div style={{ display: 'flex', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <button type="button" className="ghost-pill" onClick={() => void handlePreviewCleanup()} disabled={loadingCleanup}>
            {loadingCleanup ? 'Loading…' : 'Preview cleanup'}
          </button>
          <button type="button" className="ghost-pill" onClick={() => void handleRunCleanup()} disabled={runningCleanup || !draft.retention_policy.enabled}>
            {runningCleanup ? 'Cleaning…' : 'Run cleanup now'}
          </button>
        </div>

        {cleanupResult && (
          <div style={{ padding: '8px 0', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
            Archived {cleanupResult.archived} · deleted {cleanupResult.transcripts_deleted} transcripts · reclaimed {formatBytes(cleanupResult.reclaimed_bytes)}
          </div>
        )}

        {cleanupPreview && cleanupPreview.candidates.length > 0 && (
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
              {cleanupPreview.candidates.length} cleanup candidates · {formatBytes(cleanupPreview.total_bytes_reclaimable)} reclaimable
            </div>
            {cleanupPreview.candidates.slice(0, 5).map((c) => (
              <div key={`${c.meeting_id}-${c.action}`} style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '2px 0' }}>
                {c.title} · {c.action.replace('_', ' ')} · {formatBytes(c.bytes_reclaimable)}
              </div>
            ))}
          </div>
        )}

        {cleanupLog.length > 0 && (
          <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>Cleanup history</div>
            {cleanupLog.slice(0, 3).map((entry, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '2px 0' }}>
                {new Date(entry.timestamp).toLocaleDateString()} · reclaimed {formatBytes(entry.reclaimed_bytes)}
              </div>
            ))}
          </div>
        )}

        <SectionLabel>App</SectionLabel>

        <Row label="Launch at login">
          <Toggle value={draft.launch_at_login} onChange={(v) => updateDraft('launch_at_login', v)} label="On" />
        </Row>

        <Row label="Appearance" borderless>
          <Sel value={draft.appearance_mode} onChange={(v) => updateDraft('appearance_mode', v as AppSettings['appearance_mode'])}>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </Sel>
        </Row>
      </>
    )
  }

  function renderImport() {
    return (
      <>
        <SectionLabel>Voice Memos</SectionLabel>
        <div style={{ padding: '4px 0 8px' }}>
          <VoiceMemosImport />
        </div>
      </>
    )
  }

  function renderProfiles() {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, paddingTop: 16 }}>
        {/* Left: profile list */}
        <div>
          <div style={{ display: 'grid', gap: 4 }}>
            {profiles.map((profile) => {
              const active = profile.id === selectedProfileId
              const isDefault = profile.id === 'default'
              return (
                <button
                  key={profile.id}
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`profile-card ${active ? 'is-active' : ''}`}
                  style={{ padding: '8px 10px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div className="profile-avatar" style={{ background: `${profile.accent}22`, color: profile.accent, width: 28, height: 28, fontSize: 11 }}>
                      {initialsFor(profile.name)}
                    </div>
                    <div style={{ minWidth: 0, textAlign: 'left' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {profile.name}
                        {isDefault && <span className="chip chip-success" style={{ marginLeft: 4 }}>default</span>}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          <button
            className="ghost-pill is-selected-pill"
            onClick={createProfile}
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}
          >
            + New profile
          </button>
        </div>

        {/* Right: profile editor */}
        {activeProfile && (
          <div style={{ display: 'grid', gap: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 12px', borderBottom: '1px solid var(--border-subtle)', marginBottom: 4 }}>
              <div className="profile-avatar" style={{ background: `${activeProfile.accent}22`, color: activeProfile.accent, width: 36, height: 36 }}>
                {initialsFor(activeProfile.name)}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{activeProfile.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{isDefaultProfile ? 'Default profile · always present' : 'Custom profile'}</div>
              </div>
            </div>

            <Row label="Name">
              <Inp
                value={activeProfile.name}
                onChange={(v) => updateActiveProfile('name', v)}
                style={{ width: '100%' }}
              />
            </Row>

            <Row label="Accent color">
              <input
                type="color"
                value={activeProfile.accent}
                onChange={(e) => updateActiveProfile('accent', e.target.value)}
                style={{ width: 52, height: 32, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
              />
            </Row>

            <Row label="Archive tags" alignTop borderless>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {['general', 'work', 'customer', 'research', 'internal', 'follow-up'].map((tag) => (
                  <button
                    key={tag}
                    className={`ghost-pill${activeProfile.default_tags.includes(tag) ? ' is-selected-pill' : ''}`}
                    onClick={() => updateActiveProfile('default_tags', toggleTag(activeProfile.default_tags, tag))}
                    style={{ fontSize: 11, padding: '3px 10px' }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </Row>

            <div style={{ marginTop: 16, display: 'flex', gap: 6, alignItems: 'center' }}>
              {!isDefaultProfile && (
                <button className="ghost-pill" onClick={() => deleteProfile(activeProfile.id)}>
                  Delete profile
                </button>
              )}
              {isDefaultProfile && meetings.length > 0 && (
                <button className="ghost-pill" disabled={migrating || migrationDone} onClick={() => void handleMigrateToDefault()}>
                  {migrating ? 'Moving…' : migrationDone ? 'Done' : `Move all ${meetings.length} memos here`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="settings-modal-backdrop" onClick={() => setActiveView('today')}>
      <div className="cfg-scene" onClick={(e) => e.stopPropagation()}>
        <div className="cfg-sheet">
          {/* Header */}
          <div className="cfg-header">
            <div style={{ display: 'flex', gap: 2 }}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`cfg-tab${tab === t.id ? ' is-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  <span style={{ marginRight: 5, fontSize: 13 }}>{t.icon}</span>{t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12 }}>
              {saving && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Saving…</span>}
              {saved && !saving && <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>Saved</span>}
              <button className="ghost-pill" onClick={() => setActiveView('today')}>Done</button>
            </div>
          </div>

          {/* Error strip */}
          {error && (
            <div style={{ padding: '8px 24px', background: 'rgba(239,68,68,.08)', borderBottom: '1px solid rgba(239,68,68,.2)', fontSize: 12, color: '#ef4444', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {error}
              <button onClick={() => setError(null)} style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          )}

          {/* Body */}
          <div className="cfg-body">
            {tab === 'capture' && renderCapture()}
            {tab === 'transcription' && renderTranscription()}
            {tab === 'storage' && renderStorage()}
            {tab === 'profiles' && renderProfiles()}
            {tab === 'import' && renderImport()}
          </div>
        </div>
      </div>
    </div>
  )
}
