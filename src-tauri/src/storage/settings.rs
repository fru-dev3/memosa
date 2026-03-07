use crate::types::{AmbientModeSettings, AppSettings, AppearanceMode, CalendarProvider, IntegrationState, RetentionPolicy, WhisperModel};
use std::collections::HashMap;
use std::path::PathBuf;

pub struct SettingsManager;

impl SettingsManager {
    /// Returns the absolute path to the settings file: `~/.memosa/settings.json`.
    pub fn settings_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".memosa")
            .join("settings.json")
    }

    /// Load settings from disk. Returns `AppSettings::default()` if the file
    /// does not exist or cannot be parsed.
    pub fn load() -> AppSettings {
        let path = Self::settings_path();
        if path.exists() {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(settings) = serde_json::from_str::<AppSettings>(&json) {
                    return settings;
                }
            }
        }
        AppSettings::default()
    }

    /// Persist settings to disk, creating the `~/.memosa/` directory if needed.
    pub fn save(settings: &AppSettings) -> Result<(), String> {
        let path = Self::settings_path();
        std::fs::create_dir_all(path.parent().unwrap())
            .map_err(|e| format!("Failed to create .memosa dir: {}", e))?;
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        std::fs::write(&path, json).map_err(|e| format!("Failed to write settings.json: {}", e))?;
        Ok(())
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            storage_path: dirs::document_dir()
                .unwrap_or_default()
                .join("Memosa")
                .to_string_lossy()
                .to_string(),
            default_model: WhisperModel::Small,
            auto_record: false,
            pre_meeting_notice_seconds: 120,
            calendar_provider: CalendarProvider::LocalMacos,
            capture_system_audio: true,
            audio_input_device: None,
            launch_at_login: false,
            appearance_mode: AppearanceMode::Light,
            retention_policy: RetentionPolicy {
                enabled: false,
                recordings_delete_after_days: 30,
                transcripts_delete_after_days: 60,
                archive_after_days: 14,
                keep_starred: true,
                keep_profiles: Vec::new(),
            },
            ambient_mode: AmbientModeSettings {
                enabled: false,
                buffer_minutes: 30,
                capture_microphone: true,
                capture_system_audio: false,
                active_start_hour: 9,
                active_end_hour: 18,
                excluded_apps: vec!["1Password".to_string(), "Messages".to_string()],
                max_daily_storage_mb: 1024,
                save_hotkey: "Cmd+Shift+S".to_string(),
            },
            integration_states: HashMap::from([
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
            ]),
            summary_template_prompts: HashMap::from([
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
            ]),
            custom_summary_templates: Vec::new(),
        }
    }
}
