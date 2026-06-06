/// Live / chunked real-time transcription.
///
/// While a recording is active, `LiveTranscriber` wakes every `CHUNK_SECS`
/// seconds, drains the recorder's live PCM accumulator, writes a temp WAV,
/// resamples to 16 kHz mono via CoreAudio, runs Whisper inference, and emits
/// a `live-transcript-chunk` event to the frontend.
///
/// The stop_flag is set by `stop()` and also cleared automatically when the
/// background task exits.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

use super::models;
use super::whisper::{convert_to_whisper_format, WhisperTranscriber};
use crate::audio::AudioRecorder;
use crate::storage::SettingsManager;

/// Seconds of audio to accumulate before running Whisper on a chunk.
const CHUNK_SECS: u64 = 3;
/// Maximum characters of previous text kept as Whisper initial_prompt.
const MAX_PROMPT_CHARS: usize = 500;

#[derive(Clone, Default)]
pub struct LiveTranscriber {
    stop_flag: Arc<AtomicBool>,
}

impl LiveTranscriber {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start(
        &self,
        recorder: AudioRecorder,
        meeting_id: String,
        app_handle: tauri::AppHandle,
    ) {
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = Arc::clone(&self.stop_flag);

        tauri::async_runtime::spawn_blocking(move || {
            run_live_loop(recorder, meeting_id, app_handle, stop_flag);
        });
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
    }

    pub fn is_active(&self) -> bool {
        !self.stop_flag.load(Ordering::SeqCst)
    }
}

fn run_live_loop(
    recorder: AudioRecorder,
    meeting_id: String,
    app_handle: tauri::AppHandle,
    stop_flag: Arc<AtomicBool>,
) {
    let settings = SettingsManager::load();
    let model = models::best_available_model(&settings.default_model);
    let Some(model) = model else {
        crate::diagnostics::log("live-transcription: no model available, skipping");
        return;
    };
    let model_path = models::model_path(&model);
    if !model_path.exists() {
        crate::diagnostics::log("live-transcription: model file missing, skipping");
        return;
    }
    let transcriber = WhisperTranscriber::new(model_path);

    let mut accumulated_prompt = String::new();
    let mut time_offset_ms: i64 = 0;
    let chunk_duration = std::time::Duration::from_secs(CHUNK_SECS);

    loop {
        std::thread::sleep(chunk_duration);

        if stop_flag.load(Ordering::SeqCst) {
            break;
        }

        let (raw_pcm, capture_info) = recorder.take_live_pcm();
        let Some((sample_rate, channels)) = capture_info else {
            continue;
        };

        // Need at least 2 seconds of audio for meaningful output
        let min_samples = (sample_rate as usize) * channels as usize * 2;
        if raw_pcm.len() < min_samples {
            continue;
        }

        // Write raw PCM to a temp WAV at native sample rate
        let tmp_path = std::env::temp_dir()
            .join(format!("memosa_live_{}.wav", meeting_id));

        if let Err(e) = write_pcm_to_wav(&raw_pcm, sample_rate, channels, &tmp_path) {
            crate::diagnostics::log(format!("live-transcription: wav write error: {e}"));
            continue;
        }

        // Resample to 16 kHz mono via CoreAudio
        let samples_16k = match convert_to_whisper_format(&tmp_path) {
            Ok(s) => s,
            Err(e) => {
                crate::diagnostics::log(format!("live-transcription: resample error: {e}"));
                let _ = std::fs::remove_file(&tmp_path);
                continue;
            }
        };
        let _ = std::fs::remove_file(&tmp_path);

        // Run Whisper
        #[cfg(feature = "whisper-rs")]
        {
            match transcriber.transcribe_pcm_16k(&samples_16k, time_offset_ms, &accumulated_prompt) {
                Ok(segments) if !segments.is_empty() => {
                    let text: String = segments
                        .iter()
                        .map(|s| s.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ");

                    // Emit to frontend
                    let _ = app_handle.emit(
                        "live-transcript-chunk",
                        serde_json::json!({
                            "meeting_id": meeting_id,
                            "text": text,
                            "offset_ms": time_offset_ms,
                        }),
                    );

                    // Update context for next chunk
                    accumulated_prompt.push(' ');
                    accumulated_prompt.push_str(&text);
                    if accumulated_prompt.len() > MAX_PROMPT_CHARS {
                        let trim_at = accumulated_prompt.len() - MAX_PROMPT_CHARS;
                        accumulated_prompt = accumulated_prompt[trim_at..].to_string();
                    }
                }
                Ok(_) => {} // empty result — silence or noise
                Err(e) => {
                    crate::diagnostics::log(format!("live-transcription: whisper error: {e}"));
                }
            }
        }

        #[cfg(not(feature = "whisper-rs"))]
        {
            // CLI fallback not supported for live mode — requires file + subprocess
            let _ = samples_16k;
        }

        // Advance offset by actual chunk duration
        let chunk_ms = (raw_pcm.len() as i64 * 1000)
            / (sample_rate as i64 * channels as i64);
        time_offset_ms += chunk_ms;
    }
}

fn write_pcm_to_wav(
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    path: &std::path::Path,
) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer = hound::WavWriter::create(path, spec)
        .map_err(|e| format!("WavWriter::create error: {e}"))?;
    for &s in samples {
        writer
            .write_sample(s)
            .map_err(|e| format!("WavWriter::write_sample error: {e}"))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("WavWriter::finalize error: {e}"))?;
    Ok(())
}
