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

// ─── Bulk Markdown Export ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum MarkdownExportMode {
    ByFolder,
    ByDateRange,
    All,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MarkdownExportRequest {
    pub mode: MarkdownExportMode,
    pub folder_ids: Option<Vec<String>>,
    pub include_subfolders: Option<bool>,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    #[serde(default)]
    pub starred_only: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MarkdownExportResult {
    pub output_path: String,
    pub meeting_count: usize,
    pub total_bytes: usize,
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
    #[serde(default)]
    pub action_items: Vec<String>,
    #[serde(default)]
    pub decisions: Vec<String>,
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

// ─── Calendar ───────────────────────────────────────────────────────────────

/// Which calendar backend supplies events. `LocalMacos` is a sandbox-safe stub
/// (returns no events under MAS); `GoogleApi` uses the read-only Google Calendar
/// API via PKCE OAuth.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CalendarProvider {
    LocalMacos,
    GoogleApi,
}

impl Default for CalendarProvider {
    fn default() -> Self {
        CalendarProvider::GoogleApi
    }
}

/// Connection status surfaced to the UI.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthStatus {
    pub connected: bool,
    pub email: Option<String>,
}

/// A single calendar event, normalized across providers.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    pub start: String, // RFC3339 or YYYY-MM-DD (all-day)
    pub end: String,
    #[serde(default)]
    pub attendees: Vec<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub calendar_name: String,
    /// True when the event looks like a recordable meeting (has a video link, etc.).
    #[serde(default)]
    pub recording_candidate: bool,
    #[serde(default)]
    pub candidate_reason: Option<String>,
    #[serde(default)]
    pub meeting_platform: Option<String>,
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
    /// macOS security-scoped bookmark (base64). Managed by Rust only — frontend should
    /// pass this field through unchanged when saving settings.
    #[serde(default)]
    pub storage_path_bookmark: Option<String>,
    pub default_model: WhisperModel,
    pub capture_system_audio: bool,
    pub audio_input_device: Option<String>,
    pub launch_at_login: bool,
    #[serde(default = "default_appearance_mode")]
    pub appearance_mode: AppearanceMode,
    #[serde(default = "default_retention_policy")]
    pub retention_policy: RetentionPolicy,
    #[serde(default = "default_integration_states")]
    pub integration_states: HashMap<String, IntegrationState>,
    #[serde(default = "default_summary_template_prompts")]
    pub summary_template_prompts: HashMap<String, String>,
    #[serde(default)]
    pub custom_summary_templates: Vec<CustomSummaryTemplate>,
    #[serde(default)]
    pub has_completed_setup: bool,

    // ─── Calendar ────────────────────────────────────────────────────────────
    #[serde(default)]
    pub calendar_provider: CalendarProvider,
    /// Google OAuth client ID (desktop PKCE — not a secret). Empty until the user sets it.
    #[serde(default)]
    pub google_client_id: String,
    /// The connected account's email, shown in the UI. Populated after auth.
    #[serde(default)]
    pub calendar_account_email: Option<String>,
    /// Enable automatic recording of calendar meetings.
    #[serde(default)]
    pub auto_record: bool,
    /// Calendar names the user has opted out of (never auto-record / show).
    #[serde(default)]
    pub excluded_calendar_names: Vec<String>,

    // ─── App mode (privacy posture) ──────────────────────────────────────────
    /// Bunker = fully local, all cloud/network AI refused (fail-closed). Cloud =
    /// allow BYOK cloud providers + cloud sync. Privacy-first default: Bunker.
    #[serde(default)]
    pub app_mode: AppMode,

    // ─── AI insights engine ──────────────────────────────────────────────────
    /// Which engine generates summaries/decisions/action-items.
    #[serde(default)]
    pub insight_engine: InsightEngine,
    /// Ollama model tag used when `insight_engine == Ollama` (e.g. "llama3.1").
    #[serde(default = "default_ollama_model")]
    pub ollama_model: String,
    /// Ollama server base URL (local by default).
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    /// Cloud provider used when `insight_engine == Byok`. The API key itself is
    /// stored in the macOS Keychain, never in this file.
    #[serde(default)]
    pub byok_provider: ByokProvider,

    // ─── Integrations (sync targets) ─────────────────────────────────────────
    /// Folder of an Obsidian vault to write meeting notes into. None = not configured.
    #[serde(default)]
    pub obsidian_vault_path: Option<String>,
    /// Notion database ID to create meeting pages in. The integration token is in
    /// the Keychain, not here.
    #[serde(default)]
    pub notion_database_id: String,
}

/// App-wide privacy posture. Gates every cloud/network AI path.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppMode {
    /// Everything stays on this machine. Cloud AI (BYOK) and cloud sync are
    /// refused at the engine gate, regardless of other settings.
    Bunker,
    /// Cloud allowed: BYOK providers and cloud sync may be used.
    Cloud,
}

impl Default for AppMode {
    fn default() -> Self {
        // Privacy-first: ship locked down; the user opts into cloud explicitly.
        AppMode::Bunker
    }
}

/// Engine that produces meeting insights.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InsightEngine {
    /// Fast, offline, rule-based extraction (the original behavior). No model needed.
    Heuristic,
    /// Local LLM via Ollama — private, nothing leaves the machine.
    Ollama,
    /// Bring-your-own-key cloud LLM. Sends transcript text to the chosen provider.
    Byok,
}

impl Default for InsightEngine {
    fn default() -> Self {
        // Privacy-first default: never sends data anywhere until the user opts in.
        InsightEngine::Heuristic
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ByokProvider {
    Anthropic,
    OpenAI,
}

impl Default for ByokProvider {
    fn default() -> Self {
        ByokProvider::Anthropic
    }
}

fn default_ollama_model() -> String {
    "llama3.1".to_string()
}

fn default_ollama_url() -> String {
    "http://localhost:11434".to_string()
}

fn default_appearance_mode() -> AppearanceMode {
    AppearanceMode::Light
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
