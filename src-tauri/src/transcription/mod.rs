pub mod jobs;
pub mod models;
pub mod whisper;

pub use jobs::TranscriptionManager;

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
pub async fn cancel_transcription(
    meeting_id: String,
    state: State<'_, TranscriptionManager>,
) -> Result<(), String> {
    state.cancel_job(&meeting_id);
    Ok(())
}
