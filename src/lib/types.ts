// Whisper model sizes
export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium'

// Recording
export interface RecordingStatus {
  is_recording: boolean
  meeting_id?: string
  duration_seconds?: number
  audio_path?: string
}

export interface RecordingResult {
  meeting_id: string
  audio_path: string
  duration_seconds: number
}

export interface AudioDiagnostics {
  ffmpeg_available: boolean
  blackhole_available: boolean
  microphone_available: boolean
  selected_input_device_available: boolean
  default_input_device?: string
  default_input_device_virtual: boolean
  requested_input_device?: string
  preferred_input_device?: string
  effective_input_device?: string
  using_fallback_input_device: boolean
  input_device_error?: string
}

export interface MicrophoneProbeResult {
  effective_input_device?: string
  rms_level: number
  peak_level: number
  detected_signal: boolean
  duration_ms: number
}

export interface AudioFileStatus {
  path: string
  exists: boolean
  bytes: number
  is_empty: boolean
  is_silent: boolean
  peak_db?: number
}

export interface StorageUsage {
  total_bytes: number
  archive_bytes: number
  audio_bytes: number
  transcript_bytes: number
  metadata_bytes: number
  other_bytes: number
  meeting_count: number
  archive_count: number
}

export type CleanupAction = 'archive_meeting' | 'delete_transcript' | 'delete_meeting'

export interface CleanupCandidate {
  meeting_id: string
  title: string
  date: string
  action: CleanupAction
  reason: string
  bytes_reclaimable: number
  profile_id?: string
}

export interface CleanupPreview {
  candidates: CleanupCandidate[]
  total_bytes_reclaimable: number
  protected_count: number
}

export interface CleanupRunResult {
  archived: number
  transcripts_deleted: number
  meetings_deleted: number
  reclaimed_bytes: number
  failed: string[]
}

export interface CleanupLogEntry {
  timestamp: string
  archived: number
  meetings_deleted: number
  transcripts_deleted: number
  reclaimed_bytes: number
  failed: string[]
}

export interface IntegrationState {
  enabled: boolean
}

export type ExportAssetType = 'audio' | 'transcript' | 'summary' | 'metadata' | 'json_record'

export interface ExportRequest {
  meeting_id: string
  provider_id: string
  asset_types: ExportAssetType[]
}

export interface ExportResult {
  provider_id: string
  output_path?: string
  exported_assets: ExportAssetType[]
  note: string
}

// Transcription
export type TranscriptionStatus = 'not_started' | 'processing' | 'complete' | 'failed'

export interface ModelInfo {
  name: WhisperModel
  size_mb: number
  downloaded: boolean
  path?: string
}

// Meetings (stored)
export interface Meeting {
  id: string
  title: string
  date: string                     // YYYY-MM-DD
  start_time: string               // HH:MM
  duration_seconds: number
  audio_path: string
  transcript_path?: string
  transcription_status: TranscriptionStatus
  calendar_event_id?: string
  attendees: string[]
  whisper_model?: WhisperModel
  source_app?: string
  summary?: string
  tags?: string[]
  people?: string[]
  themes?: string[]
  keywords?: string[]
  is_favorite?: boolean
  profile_id?: string
  local_only?: boolean
}

export interface MeetingInsights {
  summary: string
  brief_summary: string
  meeting_notes: string
  themes: string[]
  people: string[]
  tags: string[]
  keywords: string[]
  action_items: string[]
  decisions: string[]
}

// Search
export interface SearchResult {
  meeting: Meeting
  snippet: string
  timestamp?: string               // HH:MM:SS
}

export interface MeetingFilter {
  from_date?: string               // YYYY-MM-DD
  to_date?: string                 // YYYY-MM-DD
  transcription_status?: TranscriptionStatus
  profile_id?: string
  source_app?: string
  tags?: string[]
  favorites_only?: boolean
}

// Settings
export interface AppSettings {
  storage_path: string
  storage_path_bookmark?: string  // macOS security-scoped bookmark (base64), managed by Rust
  default_model: WhisperModel
  capture_system_audio: boolean
  audio_input_device?: string
  launch_at_login: boolean
  appearance_mode: 'light' | 'dark' | 'system'
  retention_policy: {
    enabled: boolean
    recordings_delete_after_days: number
    transcripts_delete_after_days: number
    archive_after_days: number
    keep_starred: boolean
    keep_profiles: string[]
  }
  integration_states: Record<string, IntegrationState>
  summary_template_prompts: Record<string, string>
  custom_summary_templates: Array<{
    id: string
    label: string
    detail: string
    prompt: string
  }>
  has_completed_setup: boolean
}

export type AppView =
  | 'today'
  | 'library'
  | 'projects'
  | 'search'
  | 'export'
// 'library' is kept for backwards compat — all navigation uses 'projects'
  | 'about'
  | 'profiles'
  | 'templates'
  | 'privacy'
  | 'settings'

export type RecordingMode = 'manual'
export type RecordingInputMode = 'microphone' | 'system' | 'both'
export type SummaryTemplate =
  | 'general'
  | 'meeting_brief'
  | 'one_on_one_briefing'
  | 'customer_call'
  | 'internal_standup'
  | 'project_sync'
  | 'interview_notes'
  | 'research_notes'
  | 'lecture_notes'
  | 'personal_notes'
  | 'action_items'
  | 'decision_log'

export interface RecordingProfile {
  id: string
  name: string
  icon: string
  accent: string
  recording_mode: RecordingInputMode
  auto_transcribe: boolean
  auto_summarize: boolean
  auto_tag: boolean
  auto_export: boolean
  auto_open_after_recording: boolean
  save_path?: string
  summary_template: SummaryTemplate
  export_targets: string[]
  default_tags: string[]
  privacy_mode: 'strict' | 'balanced' | 'shareable'
  retention_days?: number
}

// Bulk Markdown Export
export type MarkdownExportMode = 'by_folder' | 'by_date_range' | 'all'

export interface MarkdownExportRequest {
  mode: MarkdownExportMode
  folder_ids?: string[]
  include_subfolders?: boolean
  from_date?: string
  to_date?: string
  starred_only?: boolean
}

export interface MarkdownExportResult {
  output_path: string
  meeting_count: number
  total_bytes: number
}

export interface HotkeyConfig {
  start_stop_recording: string
  open_command_palette: string
  quick_profile_switcher: string
}

export interface PrivacyDashboard {
  local_only_mode: boolean
  export_activity: string
  last_cloud_action: string
  encryption_status: string
  model_runtime: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  color: string
}
