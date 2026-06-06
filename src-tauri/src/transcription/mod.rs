pub mod jobs;
pub mod live;
pub mod models;
pub mod whisper;

pub use jobs::TranscriptionManager;
pub use live::LiveTranscriber;

use crate::types::{ModelInfo, TranscriptionStatus, WhisperModel};
use tauri::State;

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_available_models() -> Result<Vec<ModelInfo>, String> {
    crate::diagnostics::log("cmd:get_available_models begin");
    let models = models::get_all_model_info();
    crate::diagnostics::log(format!("cmd:get_available_models count={}", models.len()));
    Ok(models)
}

#[tauri::command]
pub async fn download_model(
    model: WhisperModel,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    models::download_model(model, app_handle).await?;
    Ok(())
}

#[tauri::command]
pub async fn transcribe_audio(
    audio_path: String,
    meeting_id: String,
    model: WhisperModel,
    state: State<'_, TranscriptionManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    state.start_job(meeting_id, audio_path, model, app_handle);
    Ok(())
}

#[tauri::command]
pub async fn get_transcription_status(
    meeting_id: String,
    state: State<'_, TranscriptionManager>,
) -> Result<TranscriptionStatus, String> {
    Ok(state.get_status(&meeting_id))
}

#[tauri::command]
pub async fn delete_model(model: WhisperModel) -> Result<(), String> {
    let path = models::model_path(&model);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_transcription(
    meeting_id: String,
    state: State<'_, TranscriptionManager>,
) -> Result<(), String> {
    state.cancel_job(&meeting_id);
    Ok(())
}

#[tauri::command]
pub async fn start_live_transcription(
    meeting_id: String,
    recorder: State<'_, crate::audio::AudioRecorder>,
    live: State<'_, LiveTranscriber>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    live.start(recorder.inner().clone(), meeting_id, app_handle);
    Ok(())
}

#[tauri::command]
pub async fn stop_live_transcription(
    live: State<'_, LiveTranscriber>,
) -> Result<(), String> {
    live.stop();
    Ok(())
}

/// Re-read a meeting's transcript and recompute its insights with the engine
/// currently selected in Settings, then persist and emit the updated meeting.
#[tauri::command]
pub async fn regenerate_insights(
    meeting_id: String,
    db: State<'_, crate::storage::Database>,
    app_handle: tauri::AppHandle,
) -> Result<crate::types::Meeting, String> {
    use tauri::Emitter;

    let meeting = db
        .get_meeting(&meeting_id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(&meeting_id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;

    let fallback = std::path::Path::new(&folder).join("transcript.md");
    let transcript_path = meeting
        .transcript_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or(fallback);
    let md = std::fs::read_to_string(&transcript_path)
        .map_err(|e| format!("Failed to read transcript: {e}"))?;

    let insights = jobs::compute_meeting_insights(&meeting, &md).await;
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
    crate::storage::fs::update_metadata(std::path::Path::new(&folder), |stored| {
        stored.summary = Some(insights.brief_summary.clone());
        stored.tags = insights.tags.clone();
        stored.people = insights.people.clone();
        stored.themes = insights.themes.clone();
        stored.keywords = insights.keywords.clone();
    })?;

    let updated = db
        .get_meeting(&meeting_id)?
        .ok_or_else(|| "Meeting not found after update".to_string())?;
    app_handle
        .emit("meeting-saved", serde_json::json!({ "meeting": updated.clone() }))
        .ok();
    Ok(updated)
}

/// Produce a speaker-attributed version of a meeting's transcript using the
/// configured AI engine (Ollama/BYOK). Labels are AI-inferred, not acoustic
/// diarization. Caches the result alongside the meeting and returns it.
#[tauri::command]
pub async fn generate_speaker_transcript(
    meeting_id: String,
    db: State<'_, crate::storage::Database>,
) -> Result<String, String> {
    let meeting = db
        .get_meeting(&meeting_id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(&meeting_id)?
        .ok_or_else(|| "Meeting folder not found".to_string())?;
    let fallback = std::path::Path::new(&folder).join("transcript.md");
    let path = meeting
        .transcript_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or(fallback);
    let md = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read transcript: {e}"))?;
    if md.trim().is_empty() {
        return Err("Transcript is empty.".into());
    }
    let capped: String = md.chars().take(24_000).collect();
    let prompt = format!(
        "Rewrite the following meeting transcript with speaker attribution. Identify distinct \
        speakers and prefix each utterance with a speaker label (use real names if clearly \
        identifiable from context, otherwise \"Speaker 1\", \"Speaker 2\", etc.). Preserve the \
        wording. Output plain text, one utterance per line formatted as \"Speaker: text\". Do not \
        add commentary or headings.\n\nTRANSCRIPT:\n{capped}"
    );
    let labeled = crate::insights::generate_text(&prompt).await?;
    let out = std::path::Path::new(&folder).join("transcript-speakers.md");
    let _ = std::fs::write(&out, &labeled);
    Ok(labeled)
}
