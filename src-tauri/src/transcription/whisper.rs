use std::path::{Path, PathBuf};

// -- Audio conversion --

/// Convert an audio file to 16 kHz mono f32 PCM samples via CoreAudio ExtAudioFile.
/// whisper.cpp (and whisper-rs) require exactly this format.
/// Replaces the `ffmpeg -ar 16000 -ac 1 -f f32le` subprocess (forbidden in MAS sandbox).
pub fn convert_to_whisper_format(input_path: &Path) -> Result<Vec<f32>, String> {
    #[cfg(target_os = "macos")]
    {
        crate::macos::convert_to_whisper_format(input_path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(format!(
            "Audio conversion not supported on this platform: {}",
            input_path.display()
        ))
    }
}

// -- Transcript segment --

#[derive(Debug, Clone)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    #[allow(dead_code)]
    pub end_ms: i64,
    pub text: String,
}

impl TranscriptSegment {
    /// Format start timestamp as HH:MM:SS for transcript.md output.
    pub fn timestamp_str(&self) -> String {
        let total_secs = self.start_ms / 1000;
        let h = total_secs / 3600;
        let m = (total_secs % 3600) / 60;
        let s = total_secs % 60;
        format!("{:02}:{:02}:{:02}", h, m, s)
    }
}

// -- WhisperTranscriber --

pub struct WhisperTranscriber {
    model_path: PathBuf,
}

impl WhisperTranscriber {
    pub fn new(model_path: PathBuf) -> Self {
        Self { model_path }
    }

    /// Transcribe audio at `audio_path`. Returns timestamped segments.
    ///
    /// Uses whisper-rs (whisper.cpp Rust bindings) -- GPU-accelerated.
    /// The whisper CLI fallback has been removed (forbidden in MAS sandbox).
    ///
    /// `progress_cb` is called with (progress 0.0-1.0, partial_text) after
    /// each decoded segment.
    pub fn transcribe<F>(
        &self,
        audio_path: &Path,
        progress_cb: F,
    ) -> Result<Vec<TranscriptSegment>, String>
    where
        F: Fn(f32, String),
    {
        #[cfg(feature = "whisper-rs")]
        {
            return self.transcribe_with_whisper_rs(audio_path, progress_cb);
        }

        #[cfg(not(feature = "whisper-rs"))]
        {
            let _ = (audio_path, &progress_cb);
            Err("Transcription requires the whisper-rs feature to be enabled".to_string())
        }
    }

    // -- whisper-rs implementation (compiled only when feature is enabled) --

    #[cfg(feature = "whisper-rs")]
    fn transcribe_with_whisper_rs<F>(
        &self,
        audio_path: &Path,
        progress_cb: F,
    ) -> Result<Vec<TranscriptSegment>, String>
    where
        F: Fn(f32, String),
    {
        use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

        // 1. Verify the audio file exists
        if !audio_path.exists() {
            return Err(
                "The audio file could not be found. It may have been moved or deleted."
                    .to_string(),
            );
        }

        // 2. Convert audio to 16 kHz mono f32 PCM
        let samples = convert_to_whisper_format(audio_path).map_err(|e| {
            eprintln!("[memosa] audio conversion failed: {}", e);
            "Could not process the audio file. It may be corrupted or in an unsupported format."
                .to_string()
        })?;

        // 3. Load model
        let ctx = WhisperContext::new_with_params(
            self.model_path.to_str().ok_or("invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| {
            eprintln!("[memosa] whisper model load error: {}", e);
            "The transcription model could not be loaded. Try re-downloading it in Settings."
                .to_string()
        })?;

        let mut state = ctx.create_state().map_err(|e| {
            eprintln!("[memosa] whisper state creation error: {}", e);
            "The transcription model could not be initialized. Try re-downloading it in Settings."
                .to_string()
        })?;

        // 4. Configure inference
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("auto"));
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(true);

        // 5. Run inference
        state
            .full(params, &samples)
            .map_err(|e| {
                eprintln!("[memosa] whisper inference error: {}", e);
                "Transcription failed. The audio file may be too short or corrupted.".to_string()
            })?;

        // 6. Collect segments
        let num_segments = state
            .full_n_segments()
            .map_err(|e| {
                eprintln!("[memosa] whisper segment count error: {}", e);
                "Transcription failed. The audio file may be too short or corrupted.".to_string()
            })?;

        let mut segments = Vec::with_capacity(num_segments as usize);

        for i in 0..num_segments {
            let text = state
                .full_get_segment_text(i)
                .map_err(|e| {
                    eprintln!("[memosa] whisper segment text error: {}", e);
                    "Transcription failed while reading results. The audio may be corrupted."
                        .to_string()
                })?;
            let start_ms = state
                .full_get_segment_t0(i)
                .map_err(|e| {
                    eprintln!("[memosa] whisper segment t0 error: {}", e);
                    "Transcription failed while reading results. The audio may be corrupted."
                        .to_string()
                })?
                * 10; // whisper timestamps are in centiseconds
            let end_ms = state
                .full_get_segment_t1(i)
                .map_err(|e| {
                    eprintln!("[memosa] whisper segment t1 error: {}", e);
                    "Transcription failed while reading results. The audio may be corrupted."
                        .to_string()
                })?
                * 10;

            let seg = TranscriptSegment {
                start_ms,
                end_ms,
                text: text.trim().to_string(),
            };

            let progress = if num_segments > 0 {
                (i + 1) as f32 / num_segments as f32
            } else {
                1.0
            };
            progress_cb(progress, seg.text.clone());
            segments.push(seg);
        }

        Ok(segments)
    }

    /// Transcribe pre-converted 16 kHz mono f32 PCM samples directly,
    /// bypassing file I/O and resampling. Used for live/chunked transcription.
    /// `time_offset_ms` is added to all segment timestamps.
    /// `initial_prompt` gives Whisper prior context (previous chunk text).
    #[cfg(feature = "whisper-rs")]
    pub fn transcribe_pcm_16k(
        &self,
        samples: &[f32],
        time_offset_ms: i64,
        initial_prompt: &str,
    ) -> Result<Vec<TranscriptSegment>, String> {
        use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

        let ctx = WhisperContext::new_with_params(
            self.model_path.to_str().ok_or("invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("whisper load error: {}", e))?;

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("whisper state error: {}", e))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("auto"));
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(true);
        if !initial_prompt.is_empty() {
            params.set_initial_prompt(initial_prompt);
        }

        state
            .full(params, samples)
            .map_err(|e| format!("whisper inference error: {}", e))?;

        let num_segments = state
            .full_n_segments()
            .map_err(|e| format!("whisper segment count error: {}", e))?;

        let mut segments = Vec::with_capacity(num_segments as usize);
        for i in 0..num_segments {
            let text = state
                .full_get_segment_text(i)
                .map_err(|e| format!("whisper segment text error: {}", e))?;
            let start_ms = state
                .full_get_segment_t0(i)
                .map_err(|e| format!("whisper t0 error: {}", e))?
                * 10
                + time_offset_ms;
            let end_ms = state
                .full_get_segment_t1(i)
                .map_err(|e| format!("whisper t1 error: {}", e))?
                * 10
                + time_offset_ms;
            let cleaned = text.trim().to_string();
            if !cleaned.is_empty() && cleaned != "[BLANK_AUDIO]" && cleaned != "[MUSIC]" {
                segments.push(TranscriptSegment {
                    start_ms,
                    end_ms,
                    text: cleaned,
                });
            }
        }

        Ok(segments)
    }
}
// Whisper CLI fallback and SRT parser have been removed.
// Shelling out to system-installed `whisper` binary is forbidden in MAS sandbox.
