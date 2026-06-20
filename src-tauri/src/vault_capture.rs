//! Capture / import into the files-only vault (spec 04).
//!
//! Brings finished audio into the vault as a fully-formed conversation: it creates
//! the conversation folder via the vault core, copies/encodes the source audio in as
//! `audio.m4a`, runs whisper.cpp (reusing [`WhisperTranscriber`]) to build a
//! [`Transcript`], writes `transcript.json` (+ derived `.txt`) atomically through the
//! vault, and records `meta.duration_sec`.
//!
//! No database. No network (transcription is fully local; whisper requires a model
//! that the user has already downloaded in Settings). Reuses the existing whisper path
//! — it never reimplements inference or audio decoding.

use crate::transcription::models::best_available_model;
use crate::transcription::whisper::{TranscriptSegment, WhisperTranscriber};
use crate::vault::{Segment, Transcript, Vault};
use crate::vault_cmds::vault_root;

use std::path::{Path, PathBuf};

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn open_vault() -> Result<Vault, String> {
    let v = Vault::new(vault_root());
    v.ensure().map_err(|e| e.to_string())?;
    Ok(v)
}

/// Place the source audio into the conversation directory as `audio.m4a`.
///
/// If the source is already `.m4a` we copy it verbatim. Anything else (typically a
/// recorder `.wav`) is encoded to AAC/m4a via the existing macOS encoder. On encode
/// failure we fall back to copying the original bytes so the recording is never lost
/// (whisper decodes from whatever ends up on disk).
fn place_audio(src: &Path, dest_dir: &Path) -> Result<PathBuf, String> {
    if !src.exists() {
        return Err("The audio file could not be found. It may have been moved or deleted.".into());
    }
    std::fs::create_dir_all(dest_dir).map_err(|e| format!("audio dir: {e}"))?;
    let dest = dest_dir.join("audio.m4a");

    let is_m4a = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("m4a") || e.eq_ignore_ascii_case("mp4") || e.eq_ignore_ascii_case("aac"))
        .unwrap_or(false);

    if is_m4a {
        std::fs::copy(src, &dest).map_err(|e| format!("copy audio: {e}"))?;
        return Ok(dest);
    }

    // Encode (e.g. WAV → M4A). encode_wav_to_m4a is the same path the recorder uses.
    let src_buf = src.to_path_buf();
    match crate::macos::encode_wav_to_m4a(&src_buf, &dest) {
        Ok(()) => Ok(dest),
        Err(e) => {
            // Keep the bytes verbatim rather than dropping the recording; whisper can
            // still decode common containers via the existing converter.
            std::fs::copy(src, &dest)
                .map_err(|copy_err| format!("encode failed ({e}); copy fallback also failed: {copy_err}"))?;
            Ok(dest)
        }
    }
}

/// Run whisper.cpp over `audio_path` and assemble a vault [`Transcript`].
///
/// Reuses [`WhisperTranscriber`] — no reimplementation of inference or audio decoding.
/// Picks the best model that is actually downloaded (preferring `Small`). Returns a
/// clear, user-facing error if no model is present so the caller can surface it.
/// Returns the transcript plus the inferred duration in seconds (from the last segment).
fn transcribe_to_vault_transcript(audio_path: &Path) -> Result<(Transcript, u64), String> {
    // Pick a downloaded model. `best_available_model` falls back tiny→base→small→medium.
    let model = best_available_model(&crate::types::WhisperModel::Small).ok_or_else(|| {
        "No transcription model is downloaded. Open Settings and download a Whisper model \
         (e.g. Base or Small), then try the import again."
            .to_string()
    })?;
    let model_file = crate::transcription::models::model_path(&model);
    if !model_file.exists() {
        return Err(
            "The transcription model is not downloaded. Please download it in Settings.".into(),
        );
    }

    let transcriber = WhisperTranscriber::new(model_file);
    let segments: Vec<TranscriptSegment> = transcriber.transcribe(audio_path, |_p, _t| {})?;

    let mut out_segments: Vec<Segment> = Vec::with_capacity(segments.len());
    let mut max_end_ms: i64 = 0;
    for s in &segments {
        if s.end_ms > max_end_ms {
            max_end_ms = s.end_ms;
        }
        let text = s.text.trim();
        if text.is_empty() || text == "[BLANK_AUDIO]" || text == "[MUSIC]" {
            continue;
        }
        out_segments.push(Segment {
            start: s.start_ms as f64 / 1000.0,
            end: s.end_ms as f64 / 1000.0,
            speaker: String::new(), // default single-speaker; diarization is a later swap
            text: text.to_string(),
        });
    }

    let transcript = Transcript {
        schema: 1,
        language: String::new(),
        model: model.to_string(),
        speakers: Default::default(),
        segments: out_segments,
    };
    let duration_sec = (max_end_ms.max(0) as u64) / 1000;
    Ok((transcript, duration_sec))
}

/// Write a finished recording into the vault as a new conversation, returning its id.
///
/// Shared by [`import_audio`] (manual / file import) and the recorder-finalize and
/// calendar hooks: copy/encode the audio in, transcribe it locally, persist the
/// transcript, and set `meta.duration_sec`. `created` is an ISO-8601 UTC stamp; pass
/// the recording's start time so the conversation slug/date is correct.
pub async fn finalize_to_vault(
    audio_path: PathBuf,
    folder: String,
    title: String,
    created: String,
) -> Result<String, String> {
    let vault = open_vault()?;

    let title = if title.trim().is_empty() {
        "Recording".to_string()
    } else {
        title
    };

    // 1. Create the conversation folder (vault assigns the canonical id/slug).
    let id = vault
        .create_conversation(&folder, &title, &created)
        .map_err(|e| e.to_string())?;
    let conv_dir = vault.root().join(&id);

    // 2. Bring the audio in as audio.m4a.
    place_audio(&audio_path, &conv_dir)?;

    // 3. Transcribe locally (CPU-bound → spawn_blocking) and write via the vault.
    let conv_audio = conv_dir.join("audio.m4a");
    let (transcript, duration_sec) =
        tokio::task::spawn_blocking(move || transcribe_to_vault_transcript(&conv_audio))
            .await
            .map_err(|e| format!("transcription task panicked: {e}"))??;

    vault
        .write_transcript(&id, &transcript)
        .map_err(|e| e.to_string())?;

    // 4. Record duration on meta.json.
    if let Ok(mut meta) = vault.read_meta(&id) {
        meta.duration_sec = duration_sec;
        vault.write_meta(&meta).map_err(|e| e.to_string())?;
    }

    Ok(id)
}

/// Import an existing audio file into the vault under `folder`, returning the ConvId.
///
/// `created` defaults to now; the title defaults to the source file stem when omitted.
pub async fn import_audio(
    src: PathBuf,
    folder: String,
    title: Option<String>,
) -> Result<String, String> {
    let title = title
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| {
            src.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Imported audio".to_string())
        });
    finalize_to_vault(src, folder, title, now_iso()).await
}

/// Tauri command: import an audio file at `src` into the vault. Returns the new ConvId.
#[tauri::command]
pub async fn vault_import_audio(
    src: String,
    folder: String,
    title: Option<String>,
) -> Result<String, String> {
    import_audio(PathBuf::from(src), folder, title).await
}
