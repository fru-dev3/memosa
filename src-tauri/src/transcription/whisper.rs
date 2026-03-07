use std::path::{Path, PathBuf};

// ── Audio conversion ──────────────────────────────────────────────────────────

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

// ── Transcript segment ────────────────────────────────────────────────────────

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

// ── WhisperTranscriber ────────────────────────────────────────────────────────

pub struct WhisperTranscriber {
    model_path: PathBuf,
}

impl WhisperTranscriber {
    pub fn new(model_path: PathBuf) -> Self {
        Self { model_path }
    }

    /// Transcribe audio at `audio_path`. Returns timestamped segments.
    ///
    /// This method tries two strategies in order:
    ///   1. whisper-rs (whisper.cpp Rust bindings) — preferred, GPU-accelerated.
    ///   2. whisper CLI fallback — used when whisper-rs is not available or
    ///      fails to initialise (e.g. the native library is missing).
    ///
    /// `progress_cb` is called with (progress 0.0–1.0, partial_text) after
    /// each decoded segment.
    pub fn transcribe<F>(
        &self,
        audio_path: &Path,
        progress_cb: F,
    ) -> Result<Vec<TranscriptSegment>, String>
    where
        F: Fn(f32, String),
    {
        // ── Strategy 1: whisper-rs ────────────────────────────────────────────
        #[cfg(feature = "whisper-rs")]
        {
            return self.transcribe_with_whisper_rs(audio_path, progress_cb);
        }

        // ── Strategy 2: whisper CLI fallback ──────────────────────────────────
        #[cfg(not(feature = "whisper-rs"))]
        {
            self.transcribe_with_cli(audio_path, progress_cb)
        }
    }

    // ── whisper-rs implementation (compiled only when feature is enabled) ─────

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

        // 1. Convert audio to 16 kHz mono f32 PCM
        let samples = convert_to_whisper_format(audio_path)?;

        // 2. Load model
        let ctx = WhisperContext::new_with_params(
            self.model_path.to_str().ok_or("invalid model path")?,
            WhisperContextParameters::default(),
        )
        .map_err(|e| format!("whisper load error: {}", e))?;

        let mut state = ctx
            .create_state()
            .map_err(|e| format!("whisper state error: {}", e))?;

        // 3. Configure inference
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("auto"));
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(true);

        // 4. Run inference
        state
            .full(params, &samples)
            .map_err(|e| format!("whisper inference error: {}", e))?;

        // 5. Collect segments
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
                .map_err(|e| format!("whisper segment t0 error: {}", e))?
                * 10; // whisper timestamps are in centiseconds
            let end_ms = state
                .full_get_segment_t1(i)
                .map_err(|e| format!("whisper segment t1 error: {}", e))?
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

    // ── CLI fallback ──────────────────────────────────────────────────────────

    /// Shell out to the `whisper` Python CLI tool:
    ///   whisper <audio> --model <name> --output_format txt --output_dir <tmp>
    ///
    /// The model name is inferred from the model file stem (e.g. "ggml-small.bin"
    /// → "small").  Output is a plain-text .txt file; we parse it into segments
    /// with synthetic 1-second spacing because the CLI txt format has no
    /// timestamps.  Use --output_format srt if timestamps are needed.
    #[cfg(not(feature = "whisper-rs"))]
    fn transcribe_with_cli<F>(
        &self,
        audio_path: &Path,
        progress_cb: F,
    ) -> Result<Vec<TranscriptSegment>, String>
    where
        F: Fn(f32, String),
    {
        // Derive model name from file stem: "ggml-small.bin" → "small"
        let model_name = self
            .model_path
            .file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.strip_prefix("ggml-"))
            .unwrap_or("small")
            .to_string();

        // Write SRT output so we get timestamps
        let tmp_dir = std::env::temp_dir().join("memosa_whisper_cli");
        std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;

        let output = std::process::Command::new("whisper")
            .args([
                audio_path.to_str().ok_or("invalid audio path")?,
                "--model",
                &model_name,
                "--output_format",
                "srt",
                "--output_dir",
                tmp_dir.to_str().ok_or("invalid tmp dir")?,
            ])
            .output()
            .map_err(|e| format!("whisper CLI launch error (is whisper installed?): {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "whisper CLI failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Locate the .srt file the CLI wrote
        let audio_stem = audio_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("audio");
        let srt_path = tmp_dir.join(format!("{}.srt", audio_stem));

        let srt_text = std::fs::read_to_string(&srt_path)
            .map_err(|e| format!("could not read whisper CLI output: {}", e))?;

        let segments = parse_srt(&srt_text);

        // Emit synthetic progress now that we have all segments
        let n = segments.len();
        for (i, seg) in segments.iter().enumerate() {
            let progress = if n > 0 {
                (i + 1) as f32 / n as f32
            } else {
                1.0
            };
            progress_cb(progress, seg.text.clone());
        }

        // Clean up
        let _ = std::fs::remove_file(&srt_path);

        Ok(segments)
    }
}

// ── SRT parser ────────────────────────────────────────────────────────────────

/// Parse an SRT subtitle file into TranscriptSegments.
///
/// SRT format:
/// ```
/// 1
/// 00:00:00,000 --> 00:00:05,000
/// First segment text.
///
/// 2
/// 00:00:05,000 --> 00:00:10,000
/// Second segment.
/// ```
#[cfg(not(feature = "whisper-rs"))]
pub fn parse_srt(srt: &str) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();
    let mut lines = srt.lines().peekable();

    while let Some(line) = lines.next() {
        let line = line.trim();

        // Skip blank lines and sequence numbers (all-digit lines)
        if line.is_empty() || line.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }

        // Try to parse a timestamp line: HH:MM:SS,mmm --> HH:MM:SS,mmm
        if let Some((start_ms, end_ms)) = parse_srt_timestamp_line(line) {
            // Collect text lines until blank line or EOF
            let mut text_parts = Vec::new();
            loop {
                match lines.peek() {
                    None => break,
                    Some(next) => {
                        if next.trim().is_empty() {
                            break;
                        }
                        text_parts.push(lines.next().unwrap().trim().to_string());
                    }
                }
            }
            let text = text_parts.join(" ");
            if !text.is_empty() {
                segments.push(TranscriptSegment {
                    start_ms,
                    end_ms,
                    text,
                });
            }
        }
    }

    segments
}

/// Parse `HH:MM:SS,mmm --> HH:MM:SS,mmm` into (start_ms, end_ms).
#[cfg(not(feature = "whisper-rs"))]
fn parse_srt_timestamp_line(line: &str) -> Option<(i64, i64)> {
    let parts: Vec<&str> = line.splitn(2, " --> ").collect();
    if parts.len() != 2 {
        return None;
    }
    let start_ms = srt_time_to_ms(parts[0].trim())?;
    let end_ms = srt_time_to_ms(parts[1].trim())?;
    Some((start_ms, end_ms))
}

/// Convert `HH:MM:SS,mmm` to milliseconds.
#[cfg(not(feature = "whisper-rs"))]
fn srt_time_to_ms(s: &str) -> Option<i64> {
    // Accept both comma and period as decimal separator
    let s = s.replace(',', ".");
    let main_frac: Vec<&str> = s.splitn(2, '.').collect();
    let time_parts: Vec<&str> = main_frac[0].split(':').collect();
    if time_parts.len() != 3 {
        return None;
    }
    let h: i64 = time_parts[0].parse().ok()?;
    let m: i64 = time_parts[1].parse().ok()?;
    let sec: i64 = time_parts[2].parse().ok()?;
    let ms: i64 = if main_frac.len() > 1 {
        let frac = main_frac[1];
        // Pad or truncate to 3 digits
        let padded = format!("{:0<3}", &frac[..frac.len().min(3)]);
        padded.parse().unwrap_or(0)
    } else {
        0
    };
    Some(h * 3_600_000 + m * 60_000 + sec * 1_000 + ms)
}
