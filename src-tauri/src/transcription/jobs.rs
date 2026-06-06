use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager};
use tokio::sync::Semaphore;

use super::models::model_path;
use super::whisper::WhisperTranscriber;
use crate::types::{Meeting, MeetingInsights, TranscriptionStatus, WhisperModel};

// ── Job state ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
enum JobState {
    Processing,
    Complete,
    #[allow(dead_code)]
    Failed(String),
    Cancelled,
}

// ── TranscriptionManager ──────────────────────────────────────────────────────

/// Manages background transcription jobs.
/// One job per meeting_id; held as Tauri managed state.
#[derive(Clone)]
pub struct TranscriptionManager {
    jobs: Arc<Mutex<HashMap<String, JobState>>>,
    /// Limits concurrent Whisper inferences to 1 to prevent OOM / system freeze.
    inference_semaphore: Arc<Semaphore>,
}

/// Build heuristic-based meeting insights from a transcript.
///
/// NOTE: These are automatic suggestions generated using keyword matching and
/// simple heuristics -- they may be inaccurate. All UI surfaces displaying this
/// data (summary, people, themes, tags, action items, decisions) should make it
/// clear that these are auto-generated suggestions, not verified facts.
/// Compute insights for a meeting using the engine selected in settings:
/// a heuristic baseline, upgraded to AI (Ollama/BYOK) when configured, and
/// falling back to the heuristic result on any AI failure.
pub async fn compute_meeting_insights(meeting: &Meeting, transcript_md: &str) -> MeetingInsights {
    let heuristic = build_meeting_insights(meeting, transcript_md, None, None);
    if crate::insights::ai_engine_selected() {
        match crate::insights::generate(transcript_md.to_string(), None).await {
            Ok(ai) => {
                crate::diagnostics::log("insights: AI generated");
                return ai;
            }
            Err(e) => {
                crate::diagnostics::log(format!("insights: AI failed, using heuristic: {e}"));
            }
        }
    }
    heuristic
}

pub fn build_meeting_insights(
    meeting: &Meeting,
    transcript_markdown: &str,
    template: Option<&str>,
    custom_prompt: Option<&str>,
) -> MeetingInsights {
    let plain_lines: Vec<String> = transcript_markdown
        .lines()
        .filter(|line| !line.starts_with('#') && !line.starts_with("**") && !line.starts_with("---"))
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| {
            if let Some((_, rest)) = line.split_once("] ") {
                rest.trim().to_string()
            } else {
                line.to_string()
            }
        })
        .collect();

    let joined = plain_lines.join(" ");
    let brief_sentences: Vec<&str> = joined
        .split_terminator(['.', '!', '?'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(2)
        .collect();

    let mut people = meeting.attendees.clone();
    people.sort();
    people.dedup();
    if people.is_empty() {
        people = infer_people(&joined);
    }

    let mut tags = meeting.tags.clone();
    if tags.is_empty() {
        tags = infer_tags(&joined);
    }

    let themes = infer_themes(&joined);
    let keywords = infer_keywords(&joined, &people, &tags, &themes);
    let action_items = infer_action_items(&plain_lines);
    let decisions = infer_decisions(&plain_lines);
    let base_summary = if brief_sentences.is_empty() {
        format!("{} captured locally in Memosa.", meeting.title)
    } else {
        brief_sentences.join(". ") + "."
    };
    let summary = format_summary_for_template(
        template,
        &base_summary,
        &people,
        &themes,
        &tags,
        &plain_lines,
        custom_prompt,
    );

    let meeting_notes = [
        format!("Summary: {}", summary),
        if people.is_empty() {
            "People: none identified".to_string()
        } else {
            format!("People: {}", people.join(", "))
        },
        if themes.is_empty() {
            "Themes: general discussion".to_string()
        } else {
            format!("Themes: {}", themes.join(", "))
        },
        if tags.is_empty() {
            "Tags: none".to_string()
        } else {
            format!("Tags: {}", tags.join(", "))
        },
        if keywords.is_empty() {
            "Keywords: none".to_string()
        } else {
            format!("Keywords: {}", keywords.join(", "))
        },
        if action_items.is_empty() {
            "Action items: none".to_string()
        } else {
            format!("Action items: {}", action_items.join(" | "))
        },
        if decisions.is_empty() {
            "Decisions: none".to_string()
        } else {
            format!("Decisions: {}", decisions.join(" | "))
        },
        if custom_prompt.map(|p| !p.trim().is_empty()).unwrap_or(false) {
            format!("Template: {}", template.unwrap_or("custom"))
        } else {
            format!("Template: {}", template.unwrap_or("general"))
        },
    ]
    .join("\n");

    MeetingInsights {
        summary: summary.clone(),
        brief_summary: base_summary,
        meeting_notes,
        themes,
        people,
        tags,
        keywords,
        action_items,
        decisions,
    }
}

fn format_summary_for_template(
    template: Option<&str>,
    base_summary: &str,
    people: &[String],
    themes: &[String],
    tags: &[String],
    plain_lines: &[String],
    custom_prompt: Option<&str>,
) -> String {
    let templated = match template.unwrap_or("general") {
        "meeting_brief" => {
            let focus = if themes.is_empty() {
                "Key discussion points were captured."
            } else {
                return format!("{} Focus: {}.", base_summary, themes.join(", "));
            };
            format!("{} {}", base_summary, focus)
        }
        "one_on_one_briefing" => {
            let participants = if people.is_empty() {
                "a 1:1 conversation"
            } else {
                "a 1:1 between participants"
            };
            format!("{} This reads like {} with emphasis on alignment and follow-through.", base_summary, participants)
        }
        "customer_call" => {
            let customer_tags = if tags.is_empty() {
                "customer context, needs, and next steps"
            } else {
                "customer context and follow-up"
            };
            format!("{} This customer-call summary highlights {}.", base_summary, customer_tags)
        }
        "project_sync" => {
            let focus = if themes.is_empty() {
                "This project sync emphasizes status, blockers, and next milestones."
            } else {
                return format!("{} Project focus: {}.", base_summary, themes.join(", "));
            };
            format!("{} {}", base_summary, focus)
        }
        "interview_notes" => {
            format!("{} This interview view emphasizes evidence, strengths, concerns, and an overall recommendation.", base_summary)
        }
        "personal_notes" => {
            format!("{} This personal-note view emphasizes reflection, ideas, and the next useful step.", base_summary)
        }
        "action_items" => {
            if tags.is_empty() {
                format!("{} Focus on the concrete next actions captured in the conversation.", base_summary)
            } else {
                format!("{} Action focus: {}.", base_summary, tags.join(", "))
            }
        }
        "decision_log" => {
            format!("{} This view emphasizes decisions, rationale, and unresolved questions.", base_summary)
        }
        _ => base_summary.to_string(),
    };

    apply_custom_prompt_guidance(&templated, plain_lines, custom_prompt)
}

fn apply_custom_prompt_guidance(
    summary: &str,
    plain_lines: &[String],
    custom_prompt: Option<&str>,
) -> String {
    let Some(prompt) = custom_prompt.map(str::trim).filter(|prompt| !prompt.is_empty()) else {
        return summary.to_string();
    };

    // Use the prompt's keywords to surface relevant content from the transcript,
    // but never include the prompt text itself in the output.
    let keywords = extract_prompt_keywords(prompt);
    if keywords.is_empty() {
        return summary.to_string();
    }

    let focused_points: Vec<String> = plain_lines
        .iter()
        .filter(|line| {
            let lower = line.to_lowercase();
            keywords.iter().any(|keyword| lower.contains(keyword))
        })
        .take(3)
        .map(|line| line.trim().to_string())
        .collect();

    if focused_points.is_empty() {
        return summary.to_string();
    }

    format!("{} {}", summary, focused_points.join(" "))
}

fn extract_prompt_keywords(prompt: &str) -> Vec<String> {
    let mut keywords = Vec::new();
    for word in prompt.split(|c: char| !c.is_alphanumeric()) {
        let normalized = word.trim().to_lowercase();
        if normalized.len() < 4 {
            continue;
        }
        if [
            "this", "that", "with", "from", "into", "your", "their", "them", "have", "will",
            "should", "focus", "summary", "summarize", "highlight",
        ]
        .contains(&normalized.as_str())
        {
            continue;
        }
        if !keywords.iter().any(|existing: &String| existing == &normalized) {
            keywords.push(normalized);
        }
        if keywords.len() >= 8 {
            break;
        }
    }
    keywords
}

fn infer_tags(content: &str) -> Vec<String> {
    let lower = content.to_lowercase();
    let candidates = [
        ("action items", "action-items"),
        ("follow up", "follow-up"),
        ("customer", "customer"),
        ("research", "research"),
        ("decision", "decision"),
        ("bug", "bug"),
        ("launch", "launch"),
        ("roadmap", "roadmap"),
        ("timeline", "timeline"),
        ("meeting", "meeting"),
    ];
    let mut tags: Vec<String> = candidates
        .iter()
        .filter(|(needle, _)| lower.contains(needle))
        .map(|(_, tag)| (*tag).to_string())
        .collect();
    tags.truncate(5);
    tags
}

fn infer_people(content: &str) -> Vec<String> {
    let mut people = Vec::new();
    for token in content.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| !c.is_alphabetic());
        if cleaned.len() < 3 {
            continue;
        }
        if cleaned.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            let lowered = cleaned.to_lowercase();
            if ["today", "meeting", "memosa", "mac", "whisper"].contains(&lowered.as_str()) {
                continue;
            }
            if !people.iter().any(|existing: &String| existing == cleaned) {
                people.push(cleaned.to_string());
            }
        }
        if people.len() >= 6 {
            break;
        }
    }
    people
}

fn infer_themes(content: &str) -> Vec<String> {
    let lower = content.to_lowercase();
    let candidates = [
        ("action item", "Action items"),
        ("follow up", "Follow-up"),
        ("decision", "Decisions"),
        ("timeline", "Timeline"),
        ("customer", "Customer discussion"),
        ("research", "Research"),
        ("launch", "Launch"),
    ];
    let mut themes: Vec<String> = candidates
        .iter()
        .filter(|(needle, _)| lower.contains(needle))
        .map(|(_, theme)| (*theme).to_string())
        .collect();
    themes.truncate(4);
    themes
}

fn infer_keywords(
    content: &str,
    people: &[String],
    tags: &[String],
    themes: &[String],
) -> Vec<String> {
    let mut keywords: Vec<String> = Vec::new();

    for value in people.iter().chain(tags.iter()).chain(themes.iter()) {
        let normalized = value.trim().to_string();
        if !normalized.is_empty() && !keywords.iter().any(|existing| existing.eq_ignore_ascii_case(&normalized)) {
            keywords.push(normalized);
        }
    }

    let stopwords = [
        "the", "and", "that", "with", "this", "from", "have", "about", "there", "their",
        "they", "into", "your", "just", "were", "been", "them", "will", "would", "could",
        "should", "meeting", "recording", "memosa",
    ];

    let mut freq: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for word in content.split(|c: char| !c.is_alphanumeric() && c != '-') {
        let normalized = word.trim().to_lowercase();
        if normalized.len() < 4 || stopwords.contains(&normalized.as_str()) {
            continue;
        }
        *freq.entry(normalized).or_insert(0) += 1;
    }

    let mut ranked: Vec<(String, usize)> = freq.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    for (keyword, _) in ranked {
        if !keywords.iter().any(|existing| existing.eq_ignore_ascii_case(&keyword)) {
            keywords.push(keyword);
        }
        if keywords.len() >= 8 {
            break;
        }
    }

    keywords.truncate(8);
    keywords
}

fn infer_action_items(lines: &[String]) -> Vec<String> {
    let markers = [
        "action item",
        "todo",
        "next step",
        "follow up",
        "follow-up",
        "need to",
        "should",
        "will ",
    ];
    let mut items = Vec::new();
    for line in lines {
        let lower = line.to_lowercase();
        if markers.iter().any(|marker| lower.contains(marker)) {
            let cleaned = line.trim().trim_end_matches('.').to_string();
            if !cleaned.is_empty() && !items.iter().any(|existing: &String| existing == &cleaned) {
                items.push(cleaned);
            }
        }
        if items.len() >= 5 {
            break;
        }
    }
    items
}

fn infer_decisions(lines: &[String]) -> Vec<String> {
    let markers = [
        "decided",
        "decision",
        "agreed",
        "we'll go with",
        "we will go with",
        "chosen",
        "approved",
    ];
    let mut items = Vec::new();
    for line in lines {
        let lower = line.to_lowercase();
        if markers.iter().any(|marker| lower.contains(marker)) {
            let cleaned = line.trim().trim_end_matches('.').to_string();
            if !cleaned.is_empty() && !items.iter().any(|existing: &String| existing == &cleaned) {
                items.push(cleaned);
            }
        }
        if items.len() >= 4 {
            break;
        }
    }
    items
}

impl TranscriptionManager {
    pub fn new() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            inference_semaphore: Arc::new(Semaphore::new(1)),
        }
    }

    /// Spawn a background transcription job (non-blocking).
    ///
    /// The job:
    ///   1. Converts audio to 16 kHz mono f32 PCM via ffmpeg.
    ///   2. Runs WhisperTranscriber::transcribe (CPU-bound, in spawn_blocking).
    ///   3. Writes transcript.md to the meeting folder.
    ///   4. Updates metadata.json transcription_status.
    ///   5. Emits transcription-complete or transcription-failed.
    pub fn start_job(
        &self,
        meeting_id: String,
        audio_path: String,
        model: WhisperModel,
        app_handle: tauri::AppHandle,
    ) {
        let _ = update_transcription_processing(&meeting_id, &audio_path, &model, &app_handle);

        {
            let mut jobs = self.jobs.lock().unwrap();
            jobs.insert(meeting_id.clone(), JobState::Processing);
        }

        let jobs = Arc::clone(&self.jobs);
        let semaphore = Arc::clone(&self.inference_semaphore);
        let meeting_id_clone = meeting_id.clone();
        let model_for_failure = model.clone();

        tauri::async_runtime::spawn(async move {
            // Acquire a permit before running inference — only 1 Whisper job at a time.
            let _permit = match semaphore.acquire().await {
                Ok(permit) => permit,
                Err(_) => {
                    let err_msg = "Transcription queue is shutting down".to_string();
                    {
                        let mut jobs = jobs.lock().unwrap();
                        jobs.insert(meeting_id_clone.clone(), JobState::Failed(err_msg.clone()));
                    }
                    let _ = update_transcription_failed(
                        &meeting_id_clone,
                        &model_for_failure,
                        &app_handle,
                    );
                    app_handle
                        .emit(
                            "transcription-failed",
                            serde_json::json!({
                                "meeting_id": meeting_id_clone,
                                "error": err_msg,
                            }),
                        )
                        .ok();
                    return;
                }
            };

            let result = run_transcription_job(
                meeting_id_clone.clone(),
                audio_path,
                model,
                app_handle.clone(),
            )
            .await;

            match result {
                Ok(transcript_path) => {
                    {
                        let mut jobs = jobs.lock().unwrap();
                        jobs.insert(meeting_id_clone.clone(), JobState::Complete);
                    }
                    app_handle
                        .emit(
                            "transcription-complete",
                            serde_json::json!({
                                "meeting_id": meeting_id_clone,
                                "transcript_path": transcript_path,
                            }),
                        )
                        .ok();
                }
                Err(e) => {
                    {
                        let mut jobs = jobs.lock().unwrap();
                        jobs.insert(meeting_id_clone.clone(), JobState::Failed(e.clone()));
                    }
                    let _ = update_transcription_failed(
                        &meeting_id_clone,
                        &model_for_failure,
                        &app_handle,
                    );
                    app_handle
                        .emit(
                            "transcription-failed",
                            serde_json::json!({
                                "meeting_id": meeting_id_clone,
                                "error": e,
                            }),
                        )
                        .ok();
                }
            }
        });
    }

    /// Cancel a running job (best-effort: marks as cancelled; the blocking
    /// thread itself cannot be interrupted mid-inference, but no further events
    /// will be emitted after the cancellation flag is set).
    pub fn cancel_job(&self, meeting_id: &str) {
        let mut jobs = self.jobs.lock().unwrap();
        if let Some(state) = jobs.get(meeting_id) {
            if matches!(state, JobState::Processing) {
                jobs.insert(meeting_id.to_string(), JobState::Cancelled);
            }
        }
    }

    /// Get the current status of a transcription job.
    pub fn get_status(&self, meeting_id: &str) -> TranscriptionStatus {
        let jobs = self.jobs.lock().unwrap();
        match jobs.get(meeting_id) {
            None => TranscriptionStatus::NotStarted,
            Some(JobState::Processing) => TranscriptionStatus::Processing,
            Some(JobState::Complete) => TranscriptionStatus::Complete,
            Some(JobState::Failed(_)) => TranscriptionStatus::Failed,
            Some(JobState::Cancelled) => TranscriptionStatus::NotStarted,
        }
    }
}

// ── Job execution ─────────────────────────────────────────────────────────────

async fn run_transcription_job(
    meeting_id: String,
    audio_path: String,
    model: WhisperModel,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let model_file = model_path(&model);
    if !model_file.exists() {
        return Err(
            "The transcription model is not downloaded. Please download it in Settings."
                .to_string(),
        );
    }

    // Verify the audio file exists before starting
    let audio_file_path = std::path::Path::new(&audio_path);
    if !audio_file_path.exists() {
        return Err(
            "The audio file could not be found. It may have been moved or deleted.".to_string(),
        );
    }

    let audio_path_clone = audio_path.clone();
    let meeting_id_clone = meeting_id.clone();
    let app_handle_clone = app_handle.clone();
    let model_file_clone = model_file.clone();

    // whisper inference is CPU-bound; run it in a blocking thread pool
    let segments = tokio::task::spawn_blocking(move || {
        let transcriber = WhisperTranscriber::new(model_file_clone);
        let audio = std::path::Path::new(&audio_path_clone);

        transcriber.transcribe(audio, |progress, partial_text| {
            app_handle_clone
                .emit(
                    "transcription-progress",
                    serde_json::json!({
                        "meeting_id": meeting_id_clone,
                        "progress": progress,
                        "partial_text": partial_text,
                    }),
                )
                .ok();
        })
    })
    .await
    .map_err(|e| {
        eprintln!("[memosa] transcription task panicked: {}", e);
        "Transcription failed unexpectedly. Please try again.".to_string()
    })??;

    // Determine the meeting folder from the audio path
    let audio_file = std::path::Path::new(&audio_path);
    let meeting_folder = audio_file
        .parent()
        .ok_or("audio_path has no parent directory")?;

    let stored_meeting = crate::storage::fs::read_metadata(meeting_folder).ok();
    let title = stored_meeting
        .as_ref()
        .map(|meeting| meeting.title.clone())
        .unwrap_or_else(|| "Meeting".to_string());
    let attendees = stored_meeting
        .as_ref()
        .map(|meeting| meeting.attendees.clone())
        .unwrap_or_default();
    let duration_secs = stored_meeting
        .as_ref()
        .map(|meeting| meeting.duration_seconds)
        .unwrap_or(0);
    let date_str = stored_meeting
        .as_ref()
        .map(|meeting| meeting.date.as_str())
        .unwrap_or("");
    let header_date = format_header_date(date_str);

    // Format duration as Hh Mm Ss
    let duration_fmt = format_duration(duration_secs);

    // Format attendees
    let attendees_fmt = if attendees.is_empty() {
        "Unknown".to_string()
    } else {
        attendees.join(", ")
    };

    // Build transcript markdown
    let mut md = String::new();
    md.push_str(&format!("# {} — {}\n\n", title, header_date));
    md.push_str(&format!("**Duration:** {}\n", duration_fmt));
    md.push_str(&format!("**Attendees:** {}\n\n", attendees_fmt));
    md.push_str("---\n\n");

    for seg in &segments {
        let clean = strip_whisper_tokens(&seg.text);
        if clean.is_empty() {
            continue;
        }
        md.push_str(&format!("[{}] {}\n", seg.timestamp_str(), clean));
    }

    // Write transcript.md
    let transcript_path = meeting_folder.join("transcript.md");
    std::fs::write(&transcript_path, &md).map_err(|e| e.to_string())?;

    crate::storage::fs::update_metadata(meeting_folder, |meeting| {
        meeting.transcription_status = TranscriptionStatus::Complete;
        meeting.transcript_path = Some(transcript_path.to_string_lossy().into_owned());
        meeting.whisper_model = Some(model.clone());
    })?;

    let db = app_handle.state::<crate::storage::Database>();
    db.update_transcription_state(
        &meeting_id,
        "complete",
        Some(transcript_path.to_string_lossy().as_ref()),
        Some(&model),
    )?;
    crate::storage::index_transcript(&meeting_id, db.inner())?;

    if let Some(meeting) = db.get_meeting(&meeting_id)? {
        let insights = compute_meeting_insights(&meeting, &md).await;
        db.update_meeting_insights(
            &meeting_id,
            &insights.brief_summary,
            &insights.tags,
            &insights.people,
            &insights.themes,
            &insights.keywords,
            &insights.action_items,
            &insights.decisions,
        )?;
        crate::storage::fs::update_metadata(meeting_folder, |stored| {
            stored.summary = Some(insights.brief_summary.clone());
            stored.tags = insights.tags.clone();
            stored.people = insights.people.clone();
            stored.themes = insights.themes.clone();
            stored.keywords = insights.keywords.clone();
        })?;
    }

    if let Some(meeting) = db.get_meeting(&meeting_id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": meeting }))
            .ok();
    }

    Ok(transcript_path.to_string_lossy().into_owned())
}

fn update_transcription_processing(
    meeting_id: &str,
    audio_path: &str,
    model: &WhisperModel,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let meeting_folder = std::path::Path::new(audio_path)
        .parent()
        .ok_or_else(|| "audio_path has no parent directory".to_string())?;

    crate::storage::fs::update_metadata(meeting_folder, |meeting| {
        meeting.transcription_status = TranscriptionStatus::Processing;
        meeting.transcript_path = None;
        meeting.whisper_model = Some(model.clone());
    })?;

    let db = app_handle.state::<crate::storage::Database>();
    db.update_transcription_state(meeting_id, "processing", None, Some(model))?;

    if let Some(meeting) = db.get_meeting(meeting_id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": meeting }))
            .ok();
    }

    Ok(())
}

fn update_transcription_failed(
    meeting_id: &str,
    model: &WhisperModel,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let db = app_handle.state::<crate::storage::Database>();
    let folder_path = db
        .get_folder_path(meeting_id)?
        .ok_or_else(|| format!("Meeting not found: {}", meeting_id))?;

    crate::storage::fs::update_metadata(std::path::Path::new(&folder_path), |meeting| {
        meeting.transcription_status = TranscriptionStatus::Failed;
        meeting.whisper_model = Some(model.clone());
    })?;

    db.update_transcription_state(meeting_id, "failed", None, Some(model))?;

    if let Some(meeting) = db.get_meeting(meeting_id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": meeting }))
            .ok();
    }

    Ok(())
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/// Format seconds as "Hh Mm Ss" (e.g. "1h 3m 5s").
fn format_duration(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    format!("{}h {}m {}s", h, m, s)
}

/// Remove Whisper special tokens (e.g. [BLANK_AUDIO], [MUSIC], [NOISE]) from a segment.
/// These are bracketed tokens containing only uppercase letters and underscores.
/// Returns the cleaned text, trimmed. Returns empty string if nothing remains.
fn strip_whisper_tokens(text: &str) -> String {
    // Match [TOKEN] patterns where TOKEN is all uppercase letters/underscores/spaces
    let mut result = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '[' {
            let mut buf = String::new();
            let mut closed = false;
            for ch in chars.by_ref() {
                if ch == ']' {
                    closed = true;
                    break;
                }
                buf.push(ch);
            }
            // Keep the bracket if it doesn't look like a Whisper token
            let is_whisper_token = closed
                && !buf.is_empty()
                && buf.chars().all(|ch| ch.is_ascii_uppercase() || ch == '_' || ch == ' ');
            if !is_whisper_token {
                result.push('[');
                result.push_str(&buf);
                if closed {
                    result.push(']');
                }
            }
        } else {
            result.push(c);
        }
    }
    result.trim().to_string()
}

/// Convert "YYYY-MM-DD" to "Month Day, Year" (e.g. "March 5, 2026").
fn format_header_date(date_str: &str) -> String {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return date_str.to_string();
    }
    let year = parts[0];
    let month_num: u32 = parts[1].parse().unwrap_or(0);
    let day: u32 = parts[2].parse().unwrap_or(0);

    let month_name = match month_num {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "Unknown",
    };

    format!("{} {}, {}", month_name, day, year)
}
