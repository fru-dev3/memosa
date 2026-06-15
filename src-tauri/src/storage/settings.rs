use crate::types::{AppSettings, AppearanceMode, IntegrationState, RetentionPolicy, WhisperModel};
use std::collections::HashMap;
use std::path::PathBuf;

pub struct SettingsManager;

impl SettingsManager {
    /// Returns the absolute path to the settings file: `Application Support/com.memosa.app/settings.json`.
    pub fn settings_path() -> PathBuf {
        crate::paths::app_data_dir().join("settings.json")
    }

    /// Load settings from disk. Returns `AppSettings::default()` if the file
    /// does not exist or cannot be parsed.
    ///
    /// On macOS, if a security-scoped bookmark is present, resolves it so that
    /// `storage_path` points to the bookmarked location and the sandbox grant
    /// is activated. This ensures all internal callers (import, recorder,
    /// cleanup, etc.) get the resolved path automatically.
    pub fn load() -> AppSettings {
        let path = Self::settings_path();
        let mut settings = if path.exists() {
            if let Ok(json) = std::fs::read_to_string(&path) {
                if let Ok(s) = serde_json::from_str::<AppSettings>(&json) {
                    s
                } else {
                    AppSettings::default()
                }
            } else {
                AppSettings::default()
            }
        } else {
            AppSettings::default()
        };

        // Resolve the security-scoped bookmark so every internal caller
        // gets sandbox access without having to duplicate this logic.
        #[cfg(target_os = "macos")]
        Self::resolve_bookmark(&mut settings);

        settings
    }

    /// On macOS, resolve a stored security-scoped bookmark. This activates
    /// the sandbox grant (via `startAccessingSecurityScopedResource`) and
    /// updates `storage_path` if the resolved URL differs from the stored one.
    /// If the bookmark is stale it is refreshed and persisted.
    #[cfg(target_os = "macos")]
    fn resolve_bookmark(settings: &mut AppSettings) {
        use super::{base64_decode, base64_encode};

        let bookmark_b64 = match settings.storage_path_bookmark.as_ref() {
            Some(b) => b.clone(),
            None => return,
        };
        let bookmark_data = match base64_decode(&bookmark_b64) {
            Ok(d) => d,
            Err(_) => return,
        };

        match crate::macos::resolve_security_bookmark(&bookmark_data) {
            Ok((resolved_path, stale)) => {
                if stale {
                    // Refresh the stale bookmark
                    if let Ok(new_data) = crate::macos::create_security_bookmark(
                        std::path::Path::new(&resolved_path),
                    ) {
                        settings.storage_path_bookmark = Some(base64_encode(&new_data));
                        let _ = Self::save(settings);
                    }
                }
                if settings.storage_path != resolved_path {
                    settings.storage_path = resolved_path;
                    let _ = Self::save(settings);
                }
            }
            Err(e) => {
                crate::diagnostics::log(format!(
                    "settings: bookmark resolution failed: {e}"
                ));
            }
        }
    }

    /// Persist settings to disk, creating the `com.memosa.app/` directory if needed.
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
            storage_path_bookmark: None,
            default_model: WhisperModel::Small,
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
            has_completed_setup: false,
            calendar_provider: crate::types::CalendarProvider::default(),
            google_client_id: String::new(),
            calendar_account_email: None,
            auto_record: false,
            excluded_calendar_names: Vec::new(),
            app_mode: crate::types::AppMode::default(),
            insight_engine: crate::types::InsightEngine::default(),
            ollama_model: "llama3.1".to_string(),
            ollama_url: "http://localhost:11434".to_string(),
            byok_provider: crate::types::ByokProvider::default(),
            obsidian_vault_path: None,
            notion_database_id: String::new(),
        }
    }
}
