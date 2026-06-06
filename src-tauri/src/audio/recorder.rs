use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

use super::mixer::{compute_rms, mix_streams};
use crate::diagnostics;
use crate::storage::{self, Database, SettingsManager};
use crate::transcription::TranscriptionManager;
use crate::types::{
    AppSettings, AudioDiagnostics, Meeting, MicrophoneProbeResult, RecordingResult, RecordingStatus,
    TranscriptionStatus,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum number of samples to keep in the `live_pcm` accumulator before
/// dropping the oldest data.  At 48 kHz mono this is ~10 minutes of audio.
/// The live transcriber is expected to drain faster than this, but in case it
/// falls behind we avoid unbounded memory growth.
const LIVE_PCM_MAX_SAMPLES: usize = 48_000 * 60 * 10; // ~10 minutes @ 48 kHz

// ---------------------------------------------------------------------------
// Public handle — returned by start() and held by Tauri state
// ---------------------------------------------------------------------------

/// Opaque handle to a live recording session.
/// Dropping this does NOT stop the recording; call `stop()` on `AudioRecorder`.
#[allow(dead_code)]
pub struct RecordingHandle;

enum StopOutcome {
    Encoded {
        path: PathBuf,
        duration: u64,
    },
    SavedWithoutEncoding {
        path: PathBuf,
        duration: u64,
        error: String,
    },
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

struct RecorderState {
    is_recording: bool,
    meeting_id: Option<String>,
    start_time: Option<std::time::Instant>,
    output_path: Option<PathBuf>,
    /// Samples accumulated since the last RMS event (written by the capture
    /// thread, drained by the level-emitter).
    level_buffer: Arc<Mutex<Vec<f32>>>,
    /// Live PCM accumulator for real-time transcription. Mixed samples at
    /// native device sample rate, drained by LiveTranscriber every few seconds.
    live_pcm: Arc<Mutex<Vec<f32>>>,
    /// (sample_rate, channels) of the live capture, set once the stream opens.
    live_capture_info: Arc<Mutex<Option<(u32, u16)>>>,
    /// Signal for the background thread to stop.
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    /// Join handle for the background capture + encode thread.
    thread_handle: Option<std::thread::JoinHandle<Result<(), String>>>,
}

impl RecorderState {
    fn new() -> Self {
        Self {
            is_recording: false,
            meeting_id: None,
            start_time: None,
            output_path: None,
            level_buffer: Arc::new(Mutex::new(Vec::new())),
            live_pcm: Arc::new(Mutex::new(Vec::new())),
            live_capture_info: Arc::new(Mutex::new(None)),
            stop_flag: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            thread_handle: None,
        }
    }
}

// ---------------------------------------------------------------------------
// AudioRecorder — the Tauri-managed state object
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AudioRecorder {
    state: Arc<Mutex<RecorderState>>,
}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(RecorderState::new())),
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// Start a recording session.  Spawns a background thread that opens cpal
    /// streams, writes a temp WAV, and later encodes to M4A via ffmpeg.
    pub fn start(
        &self,
        meeting_id: String,
        output_path: PathBuf,
        app_handle: tauri::AppHandle,
    ) -> Result<(), String> {
        let settings = SettingsManager::load();
        validate_recording_setup(&settings)?;
        diagnostics::log(format!(
            "audio:start requested meeting_id={} output_path={}",
            meeting_id,
            output_path.display()
        ));
        let mut state = self.state.lock().unwrap();

        if state.is_recording {
            return Err("Already recording".to_string());
        }

        // Prepare directories
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create output directory: {e}"))?;
        }

        // Temp WAV lives next to the final M4A
        let wav_path = output_path.with_extension("tmp.wav");

        // Reset stop flag
        state
            .stop_flag
            .store(false, std::sync::atomic::Ordering::SeqCst);

        let stop_flag = Arc::clone(&state.stop_flag);
        let level_buf = Arc::clone(&state.level_buffer);
        let live_pcm = Arc::clone(&state.live_pcm);
        let live_capture_info = Arc::clone(&state.live_capture_info);
        let meeting_id_clone = meeting_id.clone();
        let output_path_clone = output_path.clone();
        let app_handle_clone = app_handle.clone();

        // Reset live PCM from any previous session
        live_pcm.lock().unwrap().clear();
        *live_capture_info.lock().unwrap() = None;

        // Channel to get stream-open success/failure back from the thread
        let (startup_tx, startup_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        // Spawn the capture + encode thread
        let handle = std::thread::spawn(move || {
            capture_and_encode(
                meeting_id_clone,
                wav_path,
                output_path_clone,
                stop_flag,
                level_buf,
                live_pcm,
                live_capture_info,
                app_handle_clone,
                startup_tx,
            )
        });

        // Wait for the capture thread to explicitly confirm that the stream is live.
        // Do not silently assume success here; otherwise the UI can show a fake
        // recording state with no waveform and a later stop failure.
        match startup_rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(Ok(())) => {} // streams opened fine
            Ok(Err(e)) => {
                diagnostics::log(format!("audio:start failed before stream live: {e}"));
                let _ = handle.join();
                return Err(e);
            }
            Err(_) => {
                diagnostics::log("audio:start timed out waiting for live stream");
                let _ = handle.join();
                return Err(
                    "Microphone capture did not become ready in time. Check microphone permissions and the selected input device."
                        .to_string(),
                );
            }
        }

        state.is_recording = true;
        state.meeting_id = Some(meeting_id.clone());
        state.start_time = Some(std::time::Instant::now());
        state.output_path = Some(output_path);
        state.thread_handle = Some(handle);

        // Emit start event
        let _ = app_handle.emit(
            "recording-status-changed",
            RecordingStatus {
                is_recording: true,
                meeting_id: Some(meeting_id),
                duration_seconds: Some(0),
                audio_path: None,
            },
        );
        diagnostics::log("audio:start stream live; recording-status-changed emitted");

        Ok(())
    }

    /// Stop the recording session, wait for the encode thread, return
    /// (final_path, duration_seconds).
    fn stop(&self) -> Result<StopOutcome, String> {
        diagnostics::log("audio:stop requested");
        let (stop_flag, thread_handle, start_time, output_path, meeting_id) = {
            let mut state = self.state.lock().unwrap();
            if !state.is_recording {
                diagnostics::log("audio:stop rejected because recorder was not active");
                return Err("Not currently recording".to_string());
            }

            state.is_recording = false;
            let flag = Arc::clone(&state.stop_flag);
            let handle = state.thread_handle.take();
            let t = state.start_time.take();
            let p = state.output_path.take();
            let m = state.meeting_id.take();
            (flag, handle, t, p, m)
        };

        // Signal the capture thread to stop
        stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);

        // Wait for the background thread
        let thread_result = thread_handle
            .ok_or_else(|| "No recording thread found".to_string())?
            .join()
            .map_err(|_| "Recording thread panicked".to_string())?;

        let duration = start_time.map(|t| t.elapsed().as_secs()).unwrap_or(0);
        let _ = meeting_id;

        match thread_result {
            Ok(()) => {
                diagnostics::log("audio:stop completed with encoded output");
                Ok(StopOutcome::Encoded {
                    path: output_path.ok_or_else(|| "Output path missing".to_string())?,
                    duration,
                })
            }
            Err(e) => {
                if let Some(path) = output_path.as_ref().map(|p| p.with_extension("wav")) {
                    if path.exists() {
                        diagnostics::log(format!(
                            "audio:stop using wav fallback after encode failure; wav_path={} error={e}",
                            path.display()
                        ));
                        return Ok(StopOutcome::SavedWithoutEncoding {
                            error: e,
                            path,
                            duration,
                        });
                    }
                }
                diagnostics::log(format!("audio:stop failed: {e}"));
                Err(e)
            }
        }
    }

    /// Drain the live PCM accumulator and return (samples, capture_info).
    /// Returns an empty vec if no capture info is available yet.
    pub fn take_live_pcm(&self) -> (Vec<f32>, Option<(u32, u16)>) {
        let state = self.state.lock().unwrap();
        let samples = std::mem::take(&mut *state.live_pcm.lock().unwrap());
        let info = *state.live_capture_info.lock().unwrap();
        (samples, info)
    }

    pub fn get_status(&self) -> RecordingStatus {
        let state = self.state.lock().unwrap();
        RecordingStatus {
            is_recording: state.is_recording,
            meeting_id: state.meeting_id.clone(),
            duration_seconds: state.start_time.map(|t| t.elapsed().as_secs()),
            audio_path: state
                .output_path
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
        }
    }

    /// List available input device names.
    pub fn get_input_devices() -> Vec<String> {
        let host = cpal::default_host();
        match host.input_devices() {
            Ok(devices) => devices.filter_map(|d| d.name().ok()).collect(),
            Err(e) => {
                eprintln!("[audio] Could not enumerate input devices: {e}");
                Vec::new()
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Crash recovery — called on app startup to rescue abandoned temp WAVs
// ---------------------------------------------------------------------------

/// Scan `storage_path` recursively for `*.tmp.wav` files that were left behind
/// by a crash or forced quit during recording.  For each one that does NOT have
/// a corresponding `.m4a` already on disk, attempt to encode it.  Returns the
/// list of recovered `.m4a` paths (best-effort: errors are logged, not fatal).
///
/// The naming convention in `start()` is:
///   final path   = `<dir>/<name>.m4a`
///   temp WAV     = `<dir>/<name>.tmp.wav`
///
/// So for a temp file `meeting.tmp.wav` we check whether `meeting.m4a` exists.
/// If not, we encode the WAV and produce the M4A.
///
/// Call this from application initialisation (e.g. `lib.rs` setup) after the
/// storage path has been resolved.
pub fn recover_abandoned_recordings(storage_path: &Path) -> Vec<String> {
    let mut recovered: Vec<String> = Vec::new();

    if !storage_path.is_dir() {
        diagnostics::log(format!(
            "audio:recovery skipped — storage path does not exist: {}",
            storage_path.display()
        ));
        return recovered;
    }

    diagnostics::log(format!(
        "audio:recovery scanning for abandoned recordings in {}",
        storage_path.display()
    ));

    let tmp_wavs = find_tmp_wavs(storage_path);

    if tmp_wavs.is_empty() {
        diagnostics::log("audio:recovery no abandoned recordings found");
        return recovered;
    }

    diagnostics::log(format!(
        "audio:recovery found {} abandoned tmp.wav file(s)",
        tmp_wavs.len()
    ));

    for wav_path in tmp_wavs {
        // Derive the expected final M4A path.
        // tmp WAV:  /dir/name.tmp.wav   (extension added via .with_extension("tmp.wav"))
        // final:    /dir/name.m4a
        //
        // PathBuf::with_extension("tmp.wav") first strips the last extension,
        // so `name.tmp.wav` has stem = `name.tmp`.  We need to strip `.tmp`
        // from the stem to get back to `name`.
        let m4a_path = match derive_m4a_from_tmp_wav(&wav_path) {
            Some(p) => p,
            None => {
                diagnostics::log(format!(
                    "audio:recovery could not derive m4a path from {}",
                    wav_path.display()
                ));
                continue;
            }
        };

        // If the M4A already exists, the recording was finalised and the tmp
        // WAV is just a leftover.  Clean it up.
        if m4a_path.exists() {
            diagnostics::log(format!(
                "audio:recovery removing orphaned tmp.wav (m4a already exists): {}",
                wav_path.display()
            ));
            let _ = std::fs::remove_file(&wav_path);
            continue;
        }

        // Validate that the WAV file is non-empty and readable.
        match std::fs::metadata(&wav_path) {
            Ok(meta) if meta.len() > 44 => {} // WAV header is 44 bytes minimum
            Ok(_) => {
                diagnostics::log(format!(
                    "audio:recovery skipping empty/corrupt tmp.wav: {}",
                    wav_path.display()
                ));
                let _ = std::fs::remove_file(&wav_path);
                continue;
            }
            Err(e) => {
                diagnostics::log(format!(
                    "audio:recovery cannot stat {}: {e}",
                    wav_path.display()
                ));
                continue;
            }
        }

        // Attempt to encode the abandoned WAV to M4A.
        diagnostics::log(format!(
            "audio:recovery encoding abandoned recording: {}",
            wav_path.display()
        ));

        match encode_to_m4a(&wav_path, &m4a_path) {
            Ok(()) => {
                diagnostics::log(format!(
                    "audio:recovery successfully recovered: {}",
                    m4a_path.display()
                ));
                recovered.push(m4a_path.to_string_lossy().into_owned());
                // The encode_to_m4a function already removes the source WAV on
                // success (on macOS).  Remove it here too in case the platform
                // branch didn't.
                let _ = std::fs::remove_file(&wav_path);
            }
            Err(e) => {
                // Encoding failed but the WAV itself is still valuable — leave
                // it on disk so the user can manually recover.
                diagnostics::log(format!(
                    "audio:recovery encode failed for {}: {e}",
                    wav_path.display()
                ));
            }
        }
    }

    if !recovered.is_empty() {
        diagnostics::log(format!(
            "audio:recovery recovered {} recording(s)",
            recovered.len()
        ));
    }

    recovered
}

/// Recursively find all `*.tmp.wav` files under `dir`.
fn find_tmp_wavs(dir: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return results,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            results.extend(find_tmp_wavs(&path));
        } else if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".tmp.wav") {
                results.push(path);
            }
        }
    }
    results
}

/// Given a path like `/dir/name.tmp.wav`, return `/dir/name.m4a`.
fn derive_m4a_from_tmp_wav(wav_path: &Path) -> Option<PathBuf> {
    let file_name = wav_path.file_name()?.to_str()?;
    let base = file_name.strip_suffix(".tmp.wav")?;
    let mut m4a = wav_path.to_path_buf();
    m4a.set_file_name(format!("{base}.m4a"));
    Some(m4a)
}

fn ffmpeg_available() -> bool {
    // Audio encoding is handled by CoreAudio/ExtAudioFile (always available on macOS).
    true
}

fn find_input_device_by_name(host: &cpal::Host, name: &str) -> Option<cpal::Device> {
    host.input_devices().ok().and_then(|mut devices| {
        devices.find(|device| {
            device
                .name()
                .map(|candidate| candidate == name)
                .unwrap_or(false)
        })
    })
}

fn is_virtual_input_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        "blackhole",
        "joycast",
        "fru studio mic",
        "loopback",
        "aggregate",
        "virtual",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

fn looks_like_system_audio_input(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        "blackhole",
        "joycast",
        "loopback",
        "fru studio mic",
        "monitor",
        "system audio",
        "virtual",
    ]
    .iter()
    .any(|token| lower.contains(token))
}

fn preferred_input_device(host: &cpal::Host) -> Option<cpal::Device> {
    let mut devices = host.input_devices().ok()?;

    let mut fallback = None;
    while let Some(device) = devices.next() {
        let Ok(name) = device.name() else {
            continue;
        };

        if fallback.is_none() {
            fallback = Some(device.clone());
        }

        let lower = name.to_lowercase();
        let looks_physical = !is_virtual_input_name(&name)
            || lower.contains("macbook")
            || lower.contains("microphone")
            || lower.contains("built-in");

        if looks_physical {
            return Some(device);
        }
    }

    fallback
}

fn find_system_audio_device(host: &cpal::Host) -> Option<cpal::Device> {
    host.input_devices().ok().and_then(|mut devices| {
        let mut fallback = None;
        while let Some(device) = devices.next() {
            let Ok(name) = device.name() else {
                continue;
            };

            if !looks_like_system_audio_input(&name) {
                continue;
            }

            let lower = name.to_lowercase();
            if lower.contains("blackhole") {
                return Some(device);
            }

            if fallback.is_none() {
                fallback = Some(device.clone());
            }
        }

        fallback
    })
}

fn resolve_input_device(host: &cpal::Host, settings: &AppSettings) -> Result<cpal::Device, String> {
    if let Some(requested) = settings
        .audio_input_device
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return find_input_device_by_name(host, requested).ok_or_else(|| {
            format!(
                "Selected input device \"{}\" is unavailable. Choose another microphone in Settings.",
                requested
            )
        });
    }

    if let Some(default_device) = host.default_input_device() {
        if let Ok(default_name) = default_device.name() {
            if !is_virtual_input_name(&default_name) {
                return Ok(default_device);
            }
        } else {
            return Ok(default_device);
        }
    }

    preferred_input_device(host).ok_or_else(|| {
        "Microphone permission denied or no input device available. Check System Settings > Privacy > Microphone."
            .to_string()
    })
}

fn collect_audio_diagnostics(
    selected_input_device: Option<String>,
    capture_system_audio: bool,
) -> AudioDiagnostics {
    let host = cpal::default_host();
    let requested_input_device = selected_input_device.filter(|value| !value.trim().is_empty());
    let default_input_device = host
        .default_input_device()
        .and_then(|device| device.name().ok());
    let default_input_device_virtual = default_input_device
        .as_deref()
        .map(is_virtual_input_name)
        .unwrap_or(false);
    let preferred_input_device_name = preferred_input_device(&host).and_then(|device| device.name().ok());
    let selected_input_device_available = requested_input_device
        .as_deref()
        .map(|requested| find_input_device_by_name(&host, requested).is_some())
        .unwrap_or(true);
    let effective_input_device =
        if requested_input_device.is_some() && !selected_input_device_available {
            None
        } else {
            requested_input_device
                .clone()
                .or_else(|| {
                    default_input_device
                        .clone()
                        .filter(|name| !is_virtual_input_name(name))
                })
                .or_else(|| preferred_input_device_name.clone())
        };
    let using_fallback_input_device = requested_input_device.is_none()
        && default_input_device_virtual
        && effective_input_device.is_some();
    let input_device_error = if requested_input_device.is_some() && !selected_input_device_available
    {
        Some("The selected microphone is not currently available.".to_string())
    } else if effective_input_device.is_none() {
        Some(
            "No usable microphone input device found. Check macOS microphone permissions and connected devices."
                .to_string(),
        )
    } else {
        None
    };

    AudioDiagnostics {
        ffmpeg_available: ffmpeg_available(),
        blackhole_available: !capture_system_audio || find_system_audio_device(&host).is_some(),
        microphone_available: effective_input_device.is_some(),
        selected_input_device_available,
        default_input_device,
        default_input_device_virtual,
        requested_input_device,
        preferred_input_device: preferred_input_device_name,
        effective_input_device,
        using_fallback_input_device,
        input_device_error,
    }
}

fn validate_recording_setup(settings: &AppSettings) -> Result<(), String> {
    // Request microphone permission via AVFoundation before touching cpal.
    // cpal uses the CoreAudio HAL which does NOT trigger the macOS TCC dialog.
    super::permissions::ensure_microphone_permission()?;

    let host = cpal::default_host();
    let device = resolve_input_device(&host, settings)?;
    device
        .default_input_config()
        .map_err(|e| format!("Cannot access the selected input device: {e}"))?;
    Ok(())
}

fn sample_input_device(device: cpal::Device, duration_ms: u64) -> Result<MicrophoneProbeResult, String> {
    let effective_input_device = device.name().ok();
    let config = device
        .default_input_config()
        .map_err(|e| format!("Cannot access the selected input device: {e}"))?;

    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let samples_for_stream = Arc::clone(&samples);
    let stream = build_input_stream_f32(&device, &config.into(), move |data: &[f32]| {
        let mut buffer = samples_for_stream.lock().unwrap();
        buffer.extend_from_slice(data);
    })?;

    stream
        .play()
        .map_err(|e| format!("Cannot start microphone test stream: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(duration_ms));
    drop(stream);

    let captured = {
        let mut buffer = samples.lock().unwrap();
        std::mem::take(&mut *buffer)
    };

    if captured.is_empty() {
        return Ok(MicrophoneProbeResult {
            effective_input_device,
            rms_level: 0.0,
            peak_level: 0.0,
            detected_signal: false,
            duration_ms,
        });
    }

    let rms_level = compute_rms(&captured);
    let peak_level = captured
        .iter()
        .copied()
        .map(f32::abs)
        .fold(0.0_f32, f32::max);

    Ok(MicrophoneProbeResult {
        effective_input_device,
        rms_level,
        peak_level,
        detected_signal: peak_level >= 0.015 || rms_level >= 0.008,
        duration_ms,
    })
}

pub(crate) fn sample_microphone_input(settings: &AppSettings, duration_ms: u64) -> Result<MicrophoneProbeResult, String> {
    let host = cpal::default_host();
    let device = resolve_input_device(&host, settings)?;
    sample_input_device(device, duration_ms)
}

fn sample_system_audio_input(duration_ms: u64) -> Result<MicrophoneProbeResult, String> {
    let host = cpal::default_host();
    let device = find_system_audio_device(&host)
        .ok_or_else(|| "No system-audio loopback input is available on this Mac.".to_string())?;

    // Play test tone via NSSound (in-process, sandbox-safe — replaces `afplay`).
    #[cfg(target_os = "macos")]
    crate::macos::play_system_ping();

    sample_input_device(device, duration_ms)
}

/// Detect the frontmost application on macOS via NSWorkspace (sandbox-safe).
/// Returns None if detection fails or if Memosa is the frontmost app.
pub(crate) fn detect_frontmost_app() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let name = crate::macos::get_frontmost_app()?;
        if name == "Memosa" {
            None
        } else {
            Some(name)
        }
    }
    #[cfg(not(target_os = "macos"))]
    None
}

pub fn begin_recording_session(
    recorder: &AudioRecorder,
    db: &Database,
    app_handle: &tauri::AppHandle,
    meeting_id: String,
    title: String,
    calendar_event_id: Option<&str>,
    attendees: Vec<String>,
    profile_id: Option<String>,
    source_app: Option<String>,
) -> Result<Meeting, String> {
    let settings = SettingsManager::load();
    let (meeting, folder_path) = storage::create_meeting_record_with_id(
        meeting_id,
        &title,
        calendar_event_id,
        attendees,
        profile_id,
        source_app,
        &settings,
        db,
    )?;

    if let Err(error) = recorder.start(
        meeting.id.clone(),
        PathBuf::from(&meeting.audio_path),
        app_handle.clone(),
    ) {
        let _ = db.delete_meeting(&meeting.id);
        let _ = std::fs::remove_dir_all(folder_path);
        return Err(error);
    }

    app_handle
        .emit(
            "meeting-saved",
            serde_json::json!({ "meeting": meeting.clone() }),
        )
        .ok();

    Ok(meeting)
}

pub fn finalize_recording_session(
    recorder: &AudioRecorder,
    db: &Database,
    transcription: &TranscriptionManager,
    app_handle: &tauri::AppHandle,
) -> Result<RecordingResult, String> {
    let meeting_id = {
        let state = recorder.state.lock().unwrap();
        state
            .meeting_id
            .clone()
            .ok_or_else(|| "Missing meeting id for active recording".to_string())?
    };

    let stop_outcome = recorder.stop()?;
    let (audio_path, duration, transcription_error) = match stop_outcome {
        StopOutcome::Encoded { path, duration } => {
            (path.to_string_lossy().into_owned(), duration, None)
        }
        StopOutcome::SavedWithoutEncoding {
            path,
            duration,
            error,
        } => (path.to_string_lossy().into_owned(), duration, Some(error)),
    };

    app_handle
        .emit(
            "recording-status-changed",
            RecordingStatus {
                is_recording: false,
                meeting_id: Some(meeting_id.clone()),
                duration_seconds: Some(duration),
                audio_path: Some(audio_path.clone()),
            },
        )
        .ok();

    db.update_duration(&meeting_id, duration)?;
    db.update_audio_path(&meeting_id, &audio_path)?;

    let settings = SettingsManager::load();
    let default_model = settings.default_model.clone();

    // Find the best model that is actually downloaded. If none is available,
    // leave status as not_started so the user can download a model later.
    let available_model =
        crate::transcription::models::best_available_model(&default_model);

    let (transcription_status, transcription_status_str) = if transcription_error.is_some() {
        (TranscriptionStatus::Failed, "failed")
    } else if available_model.is_none() {
        (TranscriptionStatus::NotStarted, "not_started")
    } else {
        (TranscriptionStatus::Processing, "processing")
    };

    if let Some(folder_path) = db.get_folder_path(&meeting_id)? {
        storage::fs::update_metadata(std::path::Path::new(&folder_path), |meeting| {
            meeting.duration_seconds = duration;
            meeting.audio_path = audio_path.clone();
            meeting.transcript_path = None;
            meeting.transcription_status = transcription_status.clone();
            meeting.whisper_model = available_model.clone().or(Some(default_model.clone()));
        })?;
    }

    db.update_transcription_state(
        &meeting_id,
        transcription_status_str,
        None,
        available_model.as_ref().or(Some(&default_model)),
    )?;

    if let Some(meeting) = db.get_meeting(&meeting_id)? {
        app_handle
            .emit("meeting-saved", serde_json::json!({ "meeting": meeting }))
            .ok();
    }

    if let Some(error) = transcription_error {
        app_handle
            .emit(
                "transcription-failed",
                serde_json::json!({
                    "meeting_id": meeting_id,
                    "error": error,
                }),
            )
            .ok();
    } else if let Some(model) = available_model {
        transcription.start_job(
            meeting_id.clone(),
            audio_path.clone(),
            model,
            app_handle.clone(),
        );
    } else {
        // No model downloaded — notify the frontend so it can prompt the user
        app_handle
            .emit(
                "no-model-available",
                serde_json::json!({ "meeting_id": meeting_id }),
            )
            .ok();
    }

    Ok(RecordingResult {
        meeting_id,
        audio_path,
        duration_seconds: duration,
    })
}

// ---------------------------------------------------------------------------
// Background capture + encode logic
// ---------------------------------------------------------------------------

/// Opens cpal streams (mic + optional BlackHole), writes a temp WAV, then
/// shells out to ffmpeg to produce M4A.  Runs on its own OS thread.
fn capture_and_encode(
    meeting_id: String,
    wav_path: PathBuf,
    output_path: PathBuf,
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    level_buf: Arc<Mutex<Vec<f32>>>,
    live_pcm: Arc<Mutex<Vec<f32>>>,
    live_capture_info: Arc<Mutex<Option<(u32, u16)>>>,
    app_handle: tauri::AppHandle,
    startup_tx: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    diagnostics::log(format!(
        "audio:capture thread start meeting_id={} wav_path={} output_path={}",
        meeting_id,
        wav_path.display(),
        output_path.display()
    ));
    let host = cpal::default_host();
    let settings = SettingsManager::load();

    // --- Microphone ---
    let mic_device = match resolve_input_device(&host, &settings) {
        Ok(d) => d,
        Err(e) => {
            diagnostics::log(format!("audio:capture failed resolving input device: {e}"));
            let _ = startup_tx.send(Err(e.clone()));
            return Err(e);
        }
    };
    if let Ok(name) = mic_device.name() {
        diagnostics::log(format!("audio:capture using input device: {name}"));
    }

    let mic_config = match mic_device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Cannot get mic config: {e}");
            diagnostics::log(format!("audio:capture {msg}"));
            let _ = startup_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    };

    let sample_rate = mic_config.sample_rate().0;
    let channels: u16 = mic_config.channels();
    *live_capture_info.lock().unwrap() = Some((sample_rate, channels));

    // --- BlackHole (optional system audio) ---
    let system_audio_device = if settings.capture_system_audio {
        find_system_audio_device(&host)
    } else {
        None
    };

    if settings.capture_system_audio && system_audio_device.is_none() {
        eprintln!("[audio] No virtual system-audio input found — recording mic only");
        diagnostics::log("audio:capture no virtual system-audio input found; recording mic only");
    }

    // Shared PCM buffer: capture threads push samples here; main loop drains it
    // into the WAV writer.
    let pcm_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));

    // --- Build mic stream ---
    let pcm_buf_mic = Arc::clone(&pcm_buf);
    let level_buf_mic = Arc::clone(&level_buf);

    let mic_stream =
        match build_input_stream_f32(&mic_device, &mic_config.into(), move |data: &[f32]| {
            let mut buf = pcm_buf_mic.lock().unwrap();
            buf.extend_from_slice(data);
            let mut lb = level_buf_mic.lock().unwrap();
            lb.extend_from_slice(data);
        }) {
            Ok(s) => s,
            Err(e) => {
                let msg = format!("Cannot open mic stream: {e}");
                diagnostics::log(format!("audio:capture {msg}"));
                let _ = startup_tx.send(Err(msg.clone()));
                return Err(msg);
            }
        };

    match mic_stream.play() {
        Ok(()) => {
            // Signal success — mic stream is live
            diagnostics::log("audio:capture mic stream live");
            let _ = startup_tx.send(Ok(()));
        }
        Err(e) => {
            let msg = format!("Cannot start mic stream: {e}");
            diagnostics::log(format!("audio:capture {msg}"));
            let _ = startup_tx.send(Err(msg.clone()));
            return Err(msg);
        }
    }

    // --- Build BlackHole stream (optional) ---
    let bh_buf: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));

    let _bh_stream: Option<cpal::Stream> = if let Some(ref bh_dev) = system_audio_device {
        if let Ok(name) = bh_dev.name() {
            diagnostics::log(format!("audio:capture using system-audio input device: {name}"));
        }
        let bh_config = bh_dev
            .default_input_config()
            .map_err(|e| format!("Cannot get system audio input config: {e}"))?;

        let bh_buf_clone = Arc::clone(&bh_buf);
        let level_buf_bh = Arc::clone(&level_buf);
        match build_input_stream_f32(bh_dev, &bh_config.into(), move |data: &[f32]| {
            let mut buf = bh_buf_clone.lock().unwrap();
            buf.extend_from_slice(data);
            let mut lb = level_buf_bh.lock().unwrap();
            lb.extend_from_slice(data);
        }) {
            Ok(s) => {
                let _ = s.play();
                Some(s)
            }
            Err(e) => {
                eprintln!("[audio] Cannot open system audio input stream: {e} — mic only");
                diagnostics::log(format!("audio:capture cannot open system-audio stream: {e}"));
                None
            }
        }
    } else {
        None
    };

    // --- WAV writer ---
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut writer =
        WavWriter::create(&wav_path, spec).map_err(|e| {
            let msg = format!("Cannot create temp WAV: {e}");
            diagnostics::log(format!("audio:capture {msg}"));
            msg
        })?;

    // --- Main capture loop ---
    // Runs at ~100 ms intervals; drains PCM buffers, mixes, writes WAV, emits
    // audio-level events.
    let tick = std::time::Duration::from_millis(100);
    let mut last_level_emit = std::time::Instant::now();

    loop {
        std::thread::sleep(tick);

        if stop_flag.load(std::sync::atomic::Ordering::SeqCst) {
            break;
        }

        // Drain mic samples
        let mic_samples: Vec<f32> = {
            let mut buf = pcm_buf.lock().unwrap();
            std::mem::take(&mut *buf)
        };

        // Drain BlackHole samples
        let bh_samples: Vec<f32> = {
            let mut buf = bh_buf.lock().unwrap();
            std::mem::take(&mut *buf)
        };

        // Mix
        let mixed = mix_streams(&mic_samples, &bh_samples);

        // Write to WAV
        for sample in &mixed {
            writer
                .write_sample(*sample)
                .map_err(|e| {
                    let msg = format!("WAV write error: {e}");
                    diagnostics::log(format!("audio:capture {msg}"));
                    msg
                })?;
        }

        // Accumulate for live transcription (capped to prevent memory bloat).
        // If the live transcriber falls behind, drop the oldest samples so the
        // buffer never exceeds LIVE_PCM_MAX_SAMPLES.
        {
            let mut lp = live_pcm.lock().unwrap();
            lp.extend_from_slice(&mixed);
            if lp.len() > LIVE_PCM_MAX_SAMPLES {
                let excess = lp.len() - LIVE_PCM_MAX_SAMPLES;
                lp.drain(..excess);
            }
        }

        // Emit audio-level ~10x per second (every 100 ms)
        if last_level_emit.elapsed() >= std::time::Duration::from_millis(100) {
            let rms = {
                let mut lb = level_buf.lock().unwrap();
                let rms = compute_rms(&lb);
                lb.clear();
                rms
            };
            let _ = app_handle.emit("audio-level", serde_json::json!({ "level": rms }));
            last_level_emit = std::time::Instant::now();
        }
    }

    // Flush remaining samples after stop
    {
        let mic_samples: Vec<f32> = std::mem::take(&mut *pcm_buf.lock().unwrap());
        let bh_samples: Vec<f32> = std::mem::take(&mut *bh_buf.lock().unwrap());
        let mixed = mix_streams(&mic_samples, &bh_samples);
        for sample in mixed {
            // Stop on the first write error rather than appending partial/corrupt
            // samples; finalize() below still closes the file cleanly.
            if let Err(e) = writer.write_sample(sample) {
                diagnostics::log(format!("audio:capture WAV flush write error, stopping: {e}"));
                break;
            }
        }
    }

    writer
        .finalize()
        .map_err(|e| {
            let msg = format!("Cannot finalise WAV: {e}");
            diagnostics::log(format!("audio:capture {msg}"));
            msg
        })?;

    // --- ffmpeg encode ---
    diagnostics::log("audio:capture encoding wav to m4a");
    encode_to_m4a(&wav_path, &output_path)?;

    // Remove temp WAV
    let _ = std::fs::remove_file(&wav_path);
    diagnostics::log("audio:capture completed successfully");

    Ok(())
}

/// Build a cpal input stream that normalises any sample format to f32 and
/// calls `callback` with the converted data.
///
/// Because each `build_input_stream` arm moves `callback`, we wrap it in an
/// `Arc<Mutex<…>>` so it can be shared across match arms without the compiler
/// complaining about moved-out-of values.
fn build_input_stream_f32<F>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    callback: F,
) -> Result<cpal::Stream, String>
where
    F: FnMut(&[f32]) + Send + 'static,
{
    use cpal::SampleFormat;

    let supported = device
        .default_input_config()
        .map_err(|e| format!("Cannot read input config: {e}"))?;
    let fmt = supported.sample_format();

    // Wrap callback in Arc<Mutex> so the same closure can be cloned cheaply
    // into whichever single match arm ends up running.
    let cb = Arc::new(Mutex::new(callback));

    match fmt {
        SampleFormat::F32 => {
            let cb = Arc::clone(&cb);
            device
                .build_input_stream(
                    config,
                    move |data: &[f32], _| {
                        (cb.lock().unwrap())(data);
                    },
                    |e| eprintln!("[audio] stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())
        }
        SampleFormat::I16 => {
            let cb = Arc::clone(&cb);
            device
                .build_input_stream(
                    config,
                    move |data: &[i16], _| {
                        let converted: Vec<f32> =
                            data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                        (cb.lock().unwrap())(&converted);
                    },
                    |e| eprintln!("[audio] stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())
        }
        // cpal 0.15 uses U16 on some backends
        SampleFormat::U16 => {
            let cb = Arc::clone(&cb);
            device
                .build_input_stream(
                    config,
                    move |data: &[u16], _| {
                        let converted: Vec<f32> = data
                            .iter()
                            .map(|&s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)
                            .collect();
                        (cb.lock().unwrap())(&converted);
                    },
                    |e| eprintln!("[audio] stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())
        }
        _fmt => {
            // Unknown format — attempt to open as F32 and let cpal decide.
            eprintln!("[audio] Unhandled sample format {_fmt:?}, falling back to F32");
            let cb = Arc::clone(&cb);
            device
                .build_input_stream(
                    config,
                    move |data: &[f32], _| {
                        (cb.lock().unwrap())(data);
                    },
                    |e| eprintln!("[audio] stream error: {e}"),
                    None,
                )
                .map_err(|e| e.to_string())
        }
    }
}

/// Encode `wav_path` → `output_path` (M4A/AAC) using CoreAudio's ExtAudioFile.
/// Falls back to keeping the WAV (renamed to .wav) if encoding fails.
fn encode_to_m4a(wav_path: &PathBuf, output_path: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        match crate::macos::encode_wav_to_m4a(wav_path, output_path) {
            Ok(()) => {
                diagnostics::log(format!("audio:encode wrote {}", output_path.display()));
                let _ = std::fs::remove_file(wav_path);
                return Ok(());
            }
            Err(e) => {
                let wav_out = output_path.with_extension("wav");
                std::fs::rename(wav_path, &wav_out)
                    .or_else(|_| std::fs::copy(wav_path, &wav_out).map(|_| ()))
                    .map_err(|copy_err| {
                        format!("Encoding failed ({e}) and WAV fallback failed: {copy_err}")
                    })?;
                diagnostics::log(format!(
                    "audio:encode failed; saved wav fallback to {} detail={e}",
                    wav_out.display()
                ));
                return Err(format!(
                    "Audio encoding failed: {e}. Saved recording as WAV at {}",
                    wav_out.display()
                ));
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Non-macOS: keep the WAV as-is.
        let wav_out = output_path.with_extension("wav");
        std::fs::rename(wav_path, &wav_out)
            .or_else(|_| std::fs::copy(wav_path, &wav_out).map(|_| ()))
            .map_err(|e| format!("WAV fallback failed: {e}"))?;
        Err(format!(
            "M4A encoding not supported on this platform. Saved as WAV at {}",
            wav_out.display()
        ))
    }
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn start_recording(
    meeting_id: String,
    title: String,
    profile_id: Option<String>,
    state: tauri::State<'_, AudioRecorder>,
    db: tauri::State<'_, Database>,
    _transcription: tauri::State<'_, crate::transcription::TranscriptionManager>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Detect frontmost app before Memosa potentially takes focus
    let source_app = detect_frontmost_app();
    begin_recording_session(
        state.inner(),
        db.inner(),
        &app_handle,
        meeting_id,
        title,
        None,
        Vec::new(),
        profile_id,
        source_app,
    )?;

    Ok(())
}

#[tauri::command]
pub async fn stop_recording(
    state: tauri::State<'_, AudioRecorder>,
    db: tauri::State<'_, Database>,
    transcription: tauri::State<'_, TranscriptionManager>,
    app_handle: tauri::AppHandle,
) -> Result<RecordingResult, String> {
    diagnostics::log("cmd:stop_recording begin");
    // finalize_recording_session blocks on thread_handle.join() (ffmpeg encode).
    // Run it in a blocking thread to avoid starving the async runtime.
    let recorder = state.inner().clone();
    let db = db.inner().clone();
    let transcription = transcription.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        finalize_recording_session(&recorder, &db, &transcription, &app_handle)
    })
    .await
    .map_err(|e| format!("Recording thread error: {e}"))?
}

#[tauri::command]
pub async fn get_recording_status(
    state: tauri::State<'_, AudioRecorder>,
) -> Result<RecordingStatus, String> {
    crate::diagnostics::log("cmd:get_recording_status begin");
    Ok(state.get_status())
}

#[tauri::command]
pub async fn get_input_devices() -> Result<Vec<String>, String> {
    Ok(AudioRecorder::get_input_devices())
}

#[tauri::command]
pub async fn get_audio_diagnostics(
    selected_input_device: Option<String>,
    capture_system_audio: bool,
) -> Result<AudioDiagnostics, String> {
    Ok(collect_audio_diagnostics(
        selected_input_device,
        capture_system_audio,
    ))
}

#[tauri::command]
pub async fn test_microphone_input(
    selected_input_device: Option<String>,
) -> Result<MicrophoneProbeResult, String> {
    let mut settings = SettingsManager::load();
    settings.audio_input_device = selected_input_device.filter(|value| !value.trim().is_empty());
    tauri::async_runtime::spawn_blocking(move || sample_microphone_input(&settings, 3500))
        .await
        .map_err(|e| format!("Microphone test thread error: {e}"))?
}

#[tauri::command]
pub async fn test_system_audio_input() -> Result<MicrophoneProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || sample_system_audio_input(2500))
        .await
        .map_err(|e| format!("System-audio test thread error: {e}"))?
}
