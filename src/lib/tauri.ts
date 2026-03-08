import { invoke } from '@tauri-apps/api/core'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import type {
  RecordingStatus, RecordingResult, AudioDiagnostics, AudioFileStatus, MicrophoneProbeResult, WhisperModel, ModelInfo,
  TranscriptionStatus, CalendarEvent, AuthStatus, Meeting,
  SearchResult, MeetingFilter, AppSettings
  , StorageUsage, CleanupPreview, CleanupRunResult, CleanupLogEntry
  , ExportRequest, ExportResult
  , AmbientStatus
} from './types'

interface AudioLevelPayload {
  level: number
}

interface TranscriptionProgressPayload {
  meeting_id: string
  progress: number
  partial_text: string
}

interface TranscriptionCompletePayload {
  meeting_id: string
  transcript_path: string
}

interface TranscriptionFailedPayload {
  meeting_id: string
  error: string
}

interface ModelDownloadProgressPayload {
  model: string
  progress: number
}

interface ModelDownloadCompletePayload {
  model: string
  path: string
}

interface ModelDownloadFailedPayload {
  model: string
  error: string
}

interface CalendarEventsUpdatedPayload {
  events: CalendarEvent[]
}

interface AutoRecordWarningPayload {
  event: CalendarEvent
  seconds_until: number
}

interface AutoRecordStartedPayload {
  meeting_id: string
  event_id: string
}

interface MeetingSavedPayload {
  meeting: Meeting
}

interface MeetingDeletedPayload {
  id: string
}

// Audio
export const startRecording = (meetingId: string, title: string, profileId?: string) =>
  invoke<void>('start_recording', { meetingId, title, profileId })

export const stopRecording = () =>
  invoke<RecordingResult>('stop_recording')

export const getRecordingStatus = () =>
  invoke<RecordingStatus>('get_recording_status')

export const getInputDevices = () =>
  invoke<string[]>('get_input_devices')

export const getAudioDiagnostics = (selectedInputDevice?: string, captureSystemAudio = true) =>
  invoke<AudioDiagnostics>('get_audio_diagnostics', { selectedInputDevice, captureSystemAudio })

export const getAmbientStatus = () =>
  invoke<AmbientStatus>('get_ambient_status')

export const startAmbientCapture = (profileId?: string) =>
  invoke<string>('start_ambient_capture', { profileId: profileId ?? null })

export const stopAmbientCapture = () =>
  invoke<RecordingResult | null>('stop_ambient_capture')

export const saveLastAmbientSegment = () =>
  invoke<string | null>('save_last_ambient_segment')

export const testMicrophoneInput = (selectedInputDevice?: string) =>
  invoke<MicrophoneProbeResult>('test_microphone_input', { selectedInputDevice })

export const testSystemAudioInput = () =>
  invoke<MicrophoneProbeResult>('test_system_audio_input')

// Transcription
export const getAvailableModels = () =>
  invoke<ModelInfo[]>('get_available_models')

export const downloadModel = (model: WhisperModel) =>
  invoke<void>('download_model', { model })

export const deleteModel = (model: WhisperModel) =>
  invoke<void>('delete_model', { model })

export const transcribeAudio = (audioPath: string, meetingId: string, model: WhisperModel) =>
  invoke<void>('transcribe_audio', { audioPath, meetingId, model })

export const getTranscriptionStatus = (meetingId: string) =>
  invoke<TranscriptionStatus>('get_transcription_status', { meetingId })

export const cancelTranscription = (meetingId: string) =>
  invoke<void>('cancel_transcription', { meetingId })

// Calendar
export const getAuthStatus = () =>
  invoke<AuthStatus>('get_auth_status')

export const getTodayEvents = () =>
  invoke<CalendarEvent[]>('get_today_events')

export const getUpcomingEvents = (days: number) =>
  invoke<CalendarEvent[]>('get_upcoming_events', { days })

export const refreshEvents = () =>
  invoke<void>('refresh_events')

export const setAutoRecord = (enabled: boolean) =>
  invoke<void>('set_auto_record', { enabled })

export const getAutoRecord = () =>
  invoke<boolean>('get_auto_record')

export const skipAutoRecordOnce = (eventId: string) =>
  invoke<void>('skip_auto_record_once', { eventId })

// Storage
export const getMeetings = (filter: MeetingFilter) =>
  invoke<Meeting[]>('get_meetings', { filter })

export const getMeeting = (id: string) =>
  invoke<Meeting>('get_meeting', { id })

export const searchMeetings = (query: string) =>
  invoke<SearchResult[]>('search_meetings', { query })

export const deleteMeeting = (id: string) =>
  invoke<void>('delete_meeting', { id })

export const getStoragePath = () =>
  invoke<string>('get_storage_path')

export const setStoragePath = (path: string) =>
  invoke<void>('set_storage_path', { path })

export const getSettings = () =>
  invoke<AppSettings>('get_settings')

export const saveSettings = (settings: AppSettings) =>
  invoke<void>('save_settings', { settings })

export const getStorageUsage = () =>
  invoke<StorageUsage>('get_storage_usage')

export const previewCleanup = () =>
  invoke<CleanupPreview>('preview_cleanup')

export const runCleanupNow = () =>
  invoke<CleanupRunResult>('run_cleanup_now')

export const getCleanupLog = () =>
  invoke<CleanupLogEntry[]>('get_cleanup_log')

export const exportMeetingBundle = (request: ExportRequest) =>
  invoke<ExportResult>('export_meeting_bundle', { request })

export const openMeetingFolder = (id: string) =>
  invoke<void>('open_meeting_folder', { id })

export const readMeetingTranscript = (id: string) =>
  invoke<string>('read_meeting_transcript', { id })

export const saveMeetingTranscript = (id: string, content: string) =>
  invoke<void>('save_meeting_transcript', { id, content })

export const readMeetingNotes = (id: string) =>
  invoke<string>('read_meeting_notes', { id })

export const saveMeetingNotes = (id: string, content: string) =>
  invoke<void>('save_meeting_notes', { id, content })


export const saveTextFile = (filename: string, content: string) =>
  invoke<void>('save_text_file', { filename, content })

export const getMeetingAudioStatus = (id: string) =>
  invoke<AudioFileStatus>('get_meeting_audio_status', { id })

export const pickStorageFolder = (currentPath?: string) =>
  invoke<string | null>('pick_storage_folder', { currentPath })

export const renameMeeting = (id: string, title: string) =>
  invoke<void>('rename_meeting', { id, title })

export const updateMeetingProfile = (id: string, profileId?: string) =>
  invoke<void>('update_meeting_profile', { id, profileId: profileId ?? null })

// Profiles
export const loadProfiles = () =>
  invoke<unknown>('load_profiles')

export const saveProfiles = (data: unknown) =>
  invoke<void>('save_profiles', { data })

// System
export const getAppVersion = () =>
  invoke<string>('get_app_version')

export const openExternalUrl = (url: string) =>
  invoke<void>('open_external_url', { url })

// Event listeners
export const onRecordingStatusChanged = (cb: (status: RecordingStatus) => void): Promise<UnlistenFn> =>
  listen<RecordingStatus>('recording-status-changed', (e) => cb(e.payload))

export const onAudioLevel = (cb: (level: number) => void): Promise<UnlistenFn> =>
  listen<AudioLevelPayload>('audio-level', (e) => cb(e.payload.level))

export const onTranscriptionProgress = (
  cb: (data: TranscriptionProgressPayload) => void
): Promise<UnlistenFn> =>
  listen<TranscriptionProgressPayload>('transcription-progress', (e) => cb(e.payload))

export const onTranscriptionComplete = (
  cb: (data: TranscriptionCompletePayload) => void
): Promise<UnlistenFn> =>
  listen<TranscriptionCompletePayload>('transcription-complete', (e) => cb(e.payload))

export const onTranscriptionFailed = (
  cb: (data: TranscriptionFailedPayload) => void
): Promise<UnlistenFn> =>
  listen<TranscriptionFailedPayload>('transcription-failed', (e) => cb(e.payload))

export const onModelDownloadProgress = (
  cb: (data: ModelDownloadProgressPayload) => void
): Promise<UnlistenFn> =>
  listen<ModelDownloadProgressPayload>('model-download-progress', (e) => cb(e.payload))

export const onModelDownloadComplete = (
  cb: (data: ModelDownloadCompletePayload) => void
): Promise<UnlistenFn> =>
  listen<ModelDownloadCompletePayload>('model-download-complete', (e) => cb(e.payload))

export const onModelDownloadFailed = (
  cb: (data: ModelDownloadFailedPayload) => void
): Promise<UnlistenFn> =>
  listen<ModelDownloadFailedPayload>('model-download-failed', (e) => cb(e.payload))

export const onCalendarEventsUpdated = (
  cb: (events: CalendarEvent[]) => void
): Promise<UnlistenFn> =>
  listen<CalendarEventsUpdatedPayload>('calendar-events-updated', (e) => cb(e.payload.events))

export const onAutoRecordWarning = (
  cb: (data: AutoRecordWarningPayload) => void
): Promise<UnlistenFn> =>
  listen<AutoRecordWarningPayload>('auto-record-warning', (e) => cb(e.payload))

export const onAutoRecordStarted = (
  cb: (data: AutoRecordStartedPayload) => void
): Promise<UnlistenFn> =>
  listen<AutoRecordStartedPayload>('auto-record-started', (e) => cb(e.payload))

export const onMeetingSaved = (
  cb: (meeting: Meeting) => void
): Promise<UnlistenFn> =>
  listen<MeetingSavedPayload>('meeting-saved', (e) => cb(e.payload.meeting))

export const onMeetingDeleted = (
  cb: (payload: MeetingDeletedPayload) => void
): Promise<UnlistenFn> =>
  listen<MeetingDeletedPayload>('meeting-deleted', (e) => cb(e.payload))

// Global hotkey events (emitted from Rust)
export const onGlobalHotkeyToggleRecording = (cb: () => void): Promise<UnlistenFn> =>
  listen('global-hotkey-toggle-recording', () => cb())

export const onGlobalHotkeyPalette = (cb: () => void): Promise<UnlistenFn> =>
  listen('global-hotkey-palette', () => cb())

export const onGlobalHotkeyProfile = (cb: () => void): Promise<UnlistenFn> =>
  listen('global-hotkey-profile', () => cb())

export const onTrayToggleRecording = (cb: () => void): Promise<UnlistenFn> =>
  listen('tray-toggle-recording', () => cb())

// Live transcription
interface LiveTranscriptChunkPayload {
  meeting_id: string
  text: string
  offset_ms: number
}

export const startLiveTranscription = (meetingId: string) =>
  invoke<void>('start_live_transcription', { meetingId })

export const stopLiveTranscription = () =>
  invoke<void>('stop_live_transcription')

export const onLiveTranscriptChunk = (
  cb: (data: LiveTranscriptChunkPayload) => void
): Promise<UnlistenFn> =>
  listen<LiveTranscriptChunkPayload>('live-transcript-chunk', (e) => cb(e.payload))

// ─── Folder persistence ───────────────────────────────────────────────────────

export interface FolderRecord { id: string; name: string; parent_id: string | null; color: string | null }
export interface AssignmentRecord { meeting_id: string; folder_id: string }

export const getFolders = () => invoke<FolderRecord[]>('get_folders')
export const saveFolder = (id: string, name: string, parent_id: string | null, color: string | null) =>
  invoke<void>('save_folder', { id, name, parentId: parent_id, color })
export const deleteFolderRecord = (id: string) => invoke<void>('delete_folder_record', { id })
export const saveAllFolders = (folders: FolderRecord[]) => invoke<void>('save_all_folders', { folders })
export const getFolderAssignments = () => invoke<AssignmentRecord[]>('get_folder_assignments')
export const assignMeetingFolder = (meetingId: string, folderId: string) =>
  invoke<void>('assign_meeting_folder', { meetingId, folderId })
export const removeMeetingFolder = (meetingId: string, folderId: string) =>
  invoke<void>('remove_meeting_folder', { meetingId, folderId })

// ─── Screenshot capture ───────────────────────────────────────────────────────

export const captureScreenshotNow = (meetingFolder: string, meetingTitle: string) =>
  invoke<void>('capture_screenshot_now', { meetingFolder, meetingTitle })
export const startScreenshotCapture = (meetingFolder: string, meetingTitle: string, intervalSecs: number) =>
  invoke<void>('start_screenshot_capture', { meetingFolder, meetingTitle, intervalSecs })
export const stopScreenshotCapture = () =>
  invoke<void>('stop_screenshot_capture')
export const onScreenshotTaken = (cb: (data: { count: number }) => void): Promise<UnlistenFn> =>
  listen<{ count: number }>('screenshot-taken', (e) => cb(e.payload))
