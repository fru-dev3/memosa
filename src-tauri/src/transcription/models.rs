use futures_util::StreamExt;
use std::path::PathBuf;
use tauri::Emitter;

use crate::types::{ModelInfo, WhisperModel};

// ── Directory helpers ─────────────────────────────────────────────────────────

pub fn models_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("models")
}

pub fn model_path(model: &WhisperModel) -> PathBuf {
    models_dir().join(format!("ggml-{}.bin", model))
}

pub fn is_model_downloaded(model: &WhisperModel) -> bool {
    model_path(model).exists()
}

/// Return the best available model: prefers `preferred`, then falls back
/// to Tiny → Base → Small → Medium in that order. Returns `None` if no
/// model is downloaded at all.
pub fn best_available_model(preferred: &WhisperModel) -> Option<WhisperModel> {
    if model_path(preferred).exists() {
        return Some(preferred.clone());
    }
    for m in &[
        WhisperModel::Tiny,
        WhisperModel::Base,
        WhisperModel::Small,
        WhisperModel::Medium,
    ] {
        if model_path(m).exists() {
            return Some(m.clone());
        }
    }
    None
}

// ── Model metadata ────────────────────────────────────────────────────────────

pub fn model_url(model: &WhisperModel) -> &'static str {
    match model {
        WhisperModel::Tiny => {
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
        }
        WhisperModel::Base => {
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
        }
        WhisperModel::Small => {
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
        }
        WhisperModel::Medium => {
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"
        }
    }
}

pub fn model_size_mb(model: &WhisperModel) -> u64 {
    match model {
        WhisperModel::Tiny => 75,
        WhisperModel::Base => 142,
        WhisperModel::Small => 466,
        WhisperModel::Medium => 1500,
    }
}

pub fn get_all_model_info() -> Vec<ModelInfo> {
    let all = [
        WhisperModel::Tiny,
        WhisperModel::Base,
        WhisperModel::Small,
        WhisperModel::Medium,
    ];

    all.into_iter()
        .map(|m| {
            let downloaded = is_model_downloaded(&m);
            let path = if downloaded {
                Some(model_path(&m).to_string_lossy().into_owned())
            } else {
                None
            };
            ModelInfo {
                size_mb: model_size_mb(&m),
                name: m,
                downloaded,
                path,
            }
        })
        .collect()
}

// ── Download ──────────────────────────────────────────────────────────────────

/// Download a model file with streaming progress.
/// Emits `model-download-progress` events during download.
/// Emits `model-download-complete` or `model-download-failed` when done.
pub async fn download_model(
    model: WhisperModel,
    app_handle: tauri::AppHandle,
) -> Result<PathBuf, String> {
    let url = model_url(&model);
    let dest = model_path(&model);

    std::fs::create_dir_all(models_dir()).map_err(|e| e.to_string())?;

    // If already downloaded, skip
    if dest.exists() {
        app_handle
            .emit(
                "model-download-complete",
                serde_json::json!({
                    "model": model.to_string(),
                    "path": dest.to_string_lossy(),
                }),
            )
            .ok();
        return Ok(dest);
    }

    let client = reqwest::Client::new();
    let response = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let err = format!("HTTP {} downloading model", response.status());
        app_handle
            .emit(
                "model-download-failed",
                serde_json::json!({
                    "model": model.to_string(),
                    "error": err,
                }),
            )
            .ok();
        return Err(err);
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // Write to a temp file first to avoid a partial file on failure
    let tmp_dest = dest.with_extension("bin.tmp");
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp_dest).map_err(|e| e.to_string())?;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| {
                let _ = std::fs::remove_file(&tmp_dest);
                e.to_string()
            })?;
            file.write_all(&chunk).map_err(|e| {
                let _ = std::fs::remove_file(&tmp_dest);
                e.to_string()
            })?;
            downloaded += chunk.len() as u64;

            if total_size > 0 {
                let progress = downloaded as f64 / total_size as f64;
                app_handle
                    .emit(
                        "model-download-progress",
                        serde_json::json!({
                            "model": model.to_string(),
                            "progress": progress,
                        }),
                    )
                    .ok();
            }
        }
    }

    // Rename temp -> final
    std::fs::rename(&tmp_dest, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_dest);
        e.to_string()
    })?;

    app_handle
        .emit(
            "model-download-complete",
            serde_json::json!({
                "model": model.to_string(),
                "path": dest.to_string_lossy(),
            }),
        )
        .ok();

    Ok(dest)
}
