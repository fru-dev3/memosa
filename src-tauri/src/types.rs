use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Whisper model sizes
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModel {
    Tiny,
    Base,
    Small,
    Medium,
}

impl std::fmt::Display for WhisperModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WhisperModel::Tiny => write!(f, "tiny"),
            WhisperModel::Base => write!(f, "base"),
            WhisperModel::Small => write!(f, "small"),
            WhisperModel::Medium => write!(f, "medium"),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum AppearanceMode {
    Light,
    Dark,
    System,
}

// Recording
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecordingStatus {
    pub is_recording: bool,
    pub meeting_id: Option<String>,
    pub duration_seconds: Option<u64>,
    pub audio_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecordingResult {
    pub meeting_id: String,
    pub audio_path: String,
    pub duration_seconds: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioDiagnostics {
    pub ffmpeg_available: bool,
    pub blackhole_available: bool,
    pub microphone_available: bool,
    pub selected_input_device_available: bool,
    pub default_input_device: Option<String>,
    pub default_input_device_virtual: bool,
    pub requested_input_device: Option<String>,
    pub preferred_input_device: Option<String>,
    pub effective_input_device: Option<String>,
    pub using_fallback_input_device: bool,
    pub input_device_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MicrophoneProbeResult {
    pub effective_input_device: Option<String>,
    pub rms_level: f32,
    pub peak_level: f32,
    pub detected_signal: bool,
    pub duration_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AudioFileStatus {
    pub path: String,
    pub exists: bool,
    pub bytes: u64,
    pub is_empty: bool,
    pub is_silent: bool,
    pub peak_db: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StorageUsage {
    pub total_bytes: u64,
    pub archive_bytes: u64,
    pub audio_bytes: u64,
    pub transcript_bytes: u64,
    pub metadata_bytes: u64,
    pub other_bytes: u64,
    pub meeting_count: u64,
    pub archive_count: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum CleanupAction {
    ArchiveMeeting,
    DeleteTranscript,
    DeleteMeeting,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CleanupCandidate {
    pub meeting_id: String,
    pub title: String,
    pub date: String,
    pub action: CleanupAction,
    pub reason: String,
    pub bytes_reclaimable: u64,
    pub profile_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CleanupPreview {
    pub candidates: Vec<CleanupCandidate>,
    pub total_bytes_reclaimable: u64,
    pub protected_count: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CleanupRunResult {
    pub archived: u64,
    pub transcripts_deleted: u64,
    pub meetings_deleted: u64,
    pub reclaimed_bytes: u64,
    pub failed: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CleanupLogEntry {
    pub timestamp: String,
    pub archived: u64,
    pub meetings_deleted: u64,
    pub transcripts_deleted: u64,
    pub reclaimed_bytes: u64,
    pub failed: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IntegrationState {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportAssetType {
    Audio,
    Transcript,
    Summary,
    Metadata,
    JsonRecord,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportRequest {
    pub meeting_id: String,
    pub provider_id: String,
    pub asset_types: Vec<ExportAssetType>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ExportResult {
    pub provider_id: String,
    pub output_path: Option<String>,
    pub exported_assets: Vec<ExportAssetType>,
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum AmbientModeState {
    Idle,
    Capturing,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AmbientStatus {
    pub active: bool,
    pub last_saved_meeting_id: Option<String>,
    pub mode: AmbientModeState,
}

// Transcription
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionStatus {
    NotStarted,
    Processing,
    Complete,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelInfo {
    pub name: WhisperModel,
    pub size_mb: u64,
    pub downloaded: bool,
    pub path: Option<String>,
}

// Calendar
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start: String, // ISO 8601
    pub end: String,   // ISO 8601
    pub attendees: Vec<String>,
    pub location: Option<String>,
    pub description: Option<String>,
    pub calendar_name: String,
    #[serde(default)]
    pub recording_candidate: bool,
    #[serde(default)]
    pub candidate_reason: Option<String>,
    #[serde(default)]
    pub meeting_platform: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum CalendarProvider {
    GoogleApi,
    LocalMacos,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthStatus {
    pub connected: bool,
    pub email: Option<String>,
}

// Meetings (stored)
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    pub date: String,       // YYYY-MM-DD
    pub start_time: String, // HH:MM
    pub duration_seconds: u64,
    pub audio_path: String,
    pub transcript_path: Option<String>,
    pub transcription_status: TranscriptionStatus,
    pub calendar_event_id: Option<String>,
    pub attendees: Vec<String>,
    pub whisper_model: Option<WhisperModel>,
    pub profile_id: Option<String>,
    pub source_app: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub people: Vec<String>,
    #[serde(default)]
    pub themes: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub is_favorite: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MeetingInsights {
    pub summary: String,
    pub brief_summary: String,
    pub meeting_notes: String,
    pub themes: Vec<String>,
    pub people: Vec<String>,
    pub tags: Vec<String>,
    pub keywords: Vec<String>,
    pub action_items: Vec<String>,
    pub decisions: Vec<String>,
}

// Search
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchResult {
    pub meeting: Meeting,
    pub snippet: String,
    pub timestamp: Option<String>, // HH:MM:SS
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MeetingFilter {
    pub from_date: Option<String>, // YYYY-MM-DD
    pub to_date: Option<String>,   // YYYY-MM-DD
    pub transcription_status: Option<TranscriptionStatus>,
    pub profile_id: Option<String>,
}

// Settings
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomSummaryTemplate {
    pub id: String,
    pub label: String,
    pub detail: String,
    pub prompt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AmbientModeSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_ambient_buffer_minutes")]
    pub buffer_minutes: u64,
    #[serde(default)]
    pub capture_microphone: bool,
    #[serde(default)]
    pub capture_system_audio: bool,
    #[serde(default = "default_ambient_active_start_hour")]
    pub active_start_hour: u8,
    #[serde(default = "default_ambient_active_end_hour")]
    pub active_end_hour: u8,
    #[serde(default)]
    pub excluded_apps: Vec<String>,
    #[serde(default = "default_ambient_daily_storage_mb")]
    pub max_daily_storage_mb: u64,
    #[serde(default = "default_ambient_hotkey")]
    pub save_hotkey: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RetentionPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_recordings_delete_after_days")]
    pub recordings_delete_after_days: u64,
    #[serde(default = "default_transcripts_delete_after_days")]
    pub transcripts_delete_after_days: u64,
    #[serde(default = "default_archive_after_days")]
    pub archive_after_days: u64,
    #[serde(default = "default_keep_starred")]
    pub keep_starred: bool,
    #[serde(default)]
    pub keep_profiles: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    pub storage_path: String,
    pub default_model: WhisperModel,
    pub auto_record: bool,
    pub pre_meeting_notice_seconds: u64, // default 120
    #[serde(default = "default_calendar_provider")]
    pub calendar_provider: CalendarProvider,
    pub capture_system_audio: bool,
    pub audio_input_device: Option<String>,
    pub launch_at_login: bool,
    #[serde(default = "default_appearance_mode")]
    pub appearance_mode: AppearanceMode,
    #[serde(default = "default_retention_policy")]
    pub retention_policy: RetentionPolicy,
    #[serde(default = "default_ambient_mode")]
    pub ambient_mode: AmbientModeSettings,
    #[serde(default = "default_integration_states")]
    pub integration_states: HashMap<String, IntegrationState>,
    #[serde(default = "default_summary_template_prompts")]
    pub summary_template_prompts: HashMap<String, String>,
    #[serde(default)]
    pub custom_summary_templates: Vec<CustomSummaryTemplate>,
    #[serde(default)]
    pub has_completed_setup: bool,
}

fn default_appearance_mode() -> AppearanceMode {
    AppearanceMode::Light
}

fn default_calendar_provider() -> CalendarProvider {
    CalendarProvider::LocalMacos
}

fn default_recordings_delete_after_days() -> u64 {
    30
}

fn default_transcripts_delete_after_days() -> u64 {
    60
}

fn default_archive_after_days() -> u64 {
    14
}

fn default_keep_starred() -> bool {
    true
}

fn default_retention_policy() -> RetentionPolicy {
    RetentionPolicy {
        enabled: false,
        recordings_delete_after_days: default_recordings_delete_after_days(),
        transcripts_delete_after_days: default_transcripts_delete_after_days(),
        archive_after_days: default_archive_after_days(),
        keep_starred: default_keep_starred(),
        keep_profiles: Vec::new(),
    }
}

fn default_integration_states() -> HashMap<String, IntegrationState> {
    HashMap::from([
        ("google_drive".to_string(), IntegrationState { enabled: false }),
        ("box".to_string(), IntegrationState { enabled: false }),
        ("dropbox".to_string(), IntegrationState { enabled: false }),
        ("notion".to_string(), IntegrationState { enabled: false }),
        ("obsidian".to_string(), IntegrationState { enabled: false }),
        ("notebooklm".to_string(), IntegrationState { enabled: false }),
        ("snowflake".to_string(), IntegrationState { enabled: false }),
        ("supabase".to_string(), IntegrationState { enabled: false }),
        ("mysql".to_string(), IntegrationState { enabled: false }),
        ("postgresql".to_string(), IntegrationState { enabled: false }),
        ("webhook".to_string(), IntegrationState { enabled: false }),
    ])
}

fn default_ambient_buffer_minutes() -> u64 {
    30
}

fn default_ambient_active_start_hour() -> u8 {
    9
}

fn default_ambient_active_end_hour() -> u8 {
    18
}

fn default_ambient_daily_storage_mb() -> u64 {
    1024
}

fn default_ambient_hotkey() -> String {
    "Cmd+Shift+S".to_string()
}

fn default_ambient_mode() -> AmbientModeSettings {
    AmbientModeSettings {
        enabled: false,
        buffer_minutes: default_ambient_buffer_minutes(),
        capture_microphone: true,
        capture_system_audio: false,
        active_start_hour: default_ambient_active_start_hour(),
        active_end_hour: default_ambient_active_end_hour(),
        excluded_apps: vec!["1Password".to_string(), "Messages".to_string()],
        max_daily_storage_mb: default_ambient_daily_storage_mb(),
        save_hotkey: default_ambient_hotkey(),
    }
}

fn default_summary_template_prompts() -> HashMap<String, String> {
    HashMap::from([
        (
            "meeting_brief".to_string(),
            "Summarize the meeting clearly. Highlight the main discussion, the most important decisions, and the next steps."
                .to_string(),
        ),
        (
            "one_on_one_briefing".to_string(),
            "Summarize this 1:1 with emphasis on alignment, feedback, blockers, and follow-through."
                .to_string(),
        ),
        (
            "customer_call".to_string(),
            "Summarize this customer call with emphasis on customer needs, pain points, commitments, and follow-up."
                .to_string(),
        ),
        (
            "project_sync".to_string(),
            "Summarize this project sync with emphasis on status, risks, owners, and next milestones."
                .to_string(),
        ),
        (
            "interview_notes".to_string(),
            "Summarize this interview with emphasis on candidate strengths, concerns, evidence, and recommendation."
                .to_string(),
        ),
        (
            "personal_notes".to_string(),
            "Summarize this personal note with emphasis on reflections, ideas, and next actions."
                .to_string(),
        ),
        (
            "action_items".to_string(),
            "Turn this conversation into a concise action list with owners, deadlines, and follow-up needs."
                .to_string(),
        ),
        (
            "decision_log".to_string(),
            "Extract the decisions made, why they were made, and any unresolved questions."
                .to_string(),
        ),
    ])
}
