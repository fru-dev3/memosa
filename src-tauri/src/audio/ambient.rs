use super::recorder::{
    begin_recording_session, detect_frontmost_app, finalize_recording_session, sample_microphone_input,
    AudioRecorder,
};
use crate::storage::{Database, SettingsManager};
use crate::transcription::TranscriptionManager;
use crate::types::{AmbientModeState, AmbientStatus, MeetingFilter, RecordingResult};
use chrono::Timelike;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const PROBE_DURATION_MS: u64 = 1200;
const LOOP_PAUSE_MS: u64 = 1800;
const SILENCE_TICKS_TO_STOP: u8 = 4;
/// Require this many consecutive signal probes before starting a new ambient recording.
/// Prevents false starts from transient noise (door slam, keyboard, etc.).
const SIGNAL_TICKS_TO_START: u8 = 2;

struct AmbientInner {
    active: bool,
    current_meeting_id: Option<String>,
    last_saved_meeting_id: Option<String>,
    stop_flag: Arc<AtomicBool>,
}

impl Default for AmbientInner {
    fn default() -> Self {
        Self {
            active: false,
            current_meeting_id: None,
            last_saved_meeting_id: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, Default)]
pub struct AmbientController {
    inner: Arc<Mutex<AmbientInner>>,
}

impl AmbientController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> AmbientStatus {
        let state = self.inner.lock().unwrap();
        AmbientStatus {
            active: state.active,
            last_saved_meeting_id: state.last_saved_meeting_id.clone(),
            mode: if state.current_meeting_id.is_some() {
                AmbientModeState::Capturing
            } else {
                AmbientModeState::Idle
            },
        }
    }
}

fn within_active_hours(start: u8, end: u8) -> bool {
    let current_hour = chrono::Local::now().hour() as u8;
    if start == end {
        return true;
    }
    if start < end {
        current_hour >= start && current_hour < end
    } else {
        current_hour >= start || current_hour < end
    }
}

fn ambient_storage_used_today(db: &Database) -> u64 {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    db.get_meetings(&MeetingFilter {
        from_date: Some(today.clone()),
        to_date: Some(today),
        transcription_status: None,
        profile_id: None,
    })
    .unwrap_or_default()
    .into_iter()
    .filter(|meeting| meeting.source_app.as_deref() == Some("Ambient Mode"))
    .map(|meeting| std::fs::metadata(&meeting.audio_path).map(|entry| entry.len()).unwrap_or(0))
    .sum()
}

async fn stop_current_ambient_recording(
    recorder: &AudioRecorder,
    db: &Database,
    transcription: &TranscriptionManager,
    app_handle: &tauri::AppHandle,
    ambient: &AmbientController,
) -> Result<Option<RecordingResult>, String> {
    let current_meeting_id = ambient.inner.lock().unwrap().current_meeting_id.clone();
    if current_meeting_id.is_none() {
        return Ok(None);
    }
    if !recorder.get_status().is_recording {
        ambient.inner.lock().unwrap().current_meeting_id = None;
        return Ok(None);
    }

    let result = finalize_recording_session(recorder, db, transcription, app_handle)?;
    let mut state = ambient.inner.lock().unwrap();
    state.current_meeting_id = None;
    state.last_saved_meeting_id = Some(result.meeting_id.clone());
    Ok(Some(result))
}

/// Called by manual `start_recording` to gracefully save ambient capture before taking the recorder.
pub async fn stop_current_ambient_for_manual(
    recorder: &AudioRecorder,
    db: &Database,
    transcription: &TranscriptionManager,
    app_handle: &tauri::AppHandle,
    ambient: &AmbientController,
) -> Result<(), String> {
    let current_meeting_id = ambient.inner.lock().unwrap().current_meeting_id.clone();
    if current_meeting_id.is_none() {
        return Ok(());
    }
    if recorder.get_status().is_recording {
        let result = finalize_recording_session(recorder, db, transcription, app_handle)?;
        let mut state = ambient.inner.lock().unwrap();
        state.current_meeting_id = None;
        state.last_saved_meeting_id = Some(result.meeting_id);
    } else {
        ambient.inner.lock().unwrap().current_meeting_id = None;
    }
    Ok(())
}

fn should_skip_for_excluded_apps(excluded_apps: &[String]) -> bool {
    let Some(frontmost_app) = detect_frontmost_app() else {
        return false;
    };
    excluded_apps
        .iter()
        .any(|app| app.eq_ignore_ascii_case(frontmost_app.trim()))
}

async fn run_ambient_loop(
    recorder: AudioRecorder,
    db: Database,
    transcription: TranscriptionManager,
    ambient: AmbientController,
    app_handle: tauri::AppHandle,
    profile_id: Option<String>,
    stop_flag: Arc<AtomicBool>,
) {
    let mut silence_ticks = 0_u8;
    let mut signal_ticks = 0_u8;

    loop {
        if stop_flag.load(Ordering::SeqCst) {
            let _ = stop_current_ambient_recording(&recorder, &db, &transcription, &app_handle, &ambient).await;
            ambient.inner.lock().unwrap().active = false;
            break;
        }

        let settings = SettingsManager::load();
        let ambient_settings = settings.ambient_mode.clone();

        if !ambient_settings.enabled {
            tokio::time::sleep(std::time::Duration::from_millis(LOOP_PAUSE_MS)).await;
            continue;
        }

        if !within_active_hours(
            ambient_settings.active_start_hour,
            ambient_settings.active_end_hour,
        ) {
            let _ = stop_current_ambient_recording(&recorder, &db, &transcription, &app_handle, &ambient).await;
            tokio::time::sleep(std::time::Duration::from_millis(LOOP_PAUSE_MS)).await;
            continue;
        }

        if should_skip_for_excluded_apps(&ambient_settings.excluded_apps) {
            let _ = stop_current_ambient_recording(&recorder, &db, &transcription, &app_handle, &ambient).await;
            tokio::time::sleep(std::time::Duration::from_millis(LOOP_PAUSE_MS)).await;
            continue;
        }

        let used_today = ambient_storage_used_today(&db);
        if used_today >= ambient_settings.max_daily_storage_mb * 1024 * 1024 {
            let _ = stop_current_ambient_recording(&recorder, &db, &transcription, &app_handle, &ambient).await;
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            continue;
        }

        let mut probe_settings = settings.clone();
        probe_settings.capture_system_audio = ambient_settings.capture_system_audio;
        if !ambient_settings.capture_microphone {
            tokio::time::sleep(std::time::Duration::from_millis(LOOP_PAUSE_MS)).await;
            continue;
        }

        let probe_result = tauri::async_runtime::spawn_blocking(move || {
            sample_microphone_input(&probe_settings, PROBE_DURATION_MS)
        })
        .await
        .ok()
        .and_then(Result::ok);

        let detected_signal = probe_result
            .as_ref()
            .map(|result| result.detected_signal)
            .unwrap_or(false);

        let current_meeting_id = ambient.inner.lock().unwrap().current_meeting_id.clone();
        if current_meeting_id.is_none() {
            if detected_signal {
                signal_ticks = signal_ticks.saturating_add(1);
            } else {
                signal_ticks = 0;
            }
            if signal_ticks >= SIGNAL_TICKS_TO_START {
                let meeting_id = format!("ambient-{}", chrono::Utc::now().timestamp_millis());
                let title = format!("Ambient capture {}", chrono::Local::now().format("%H:%M"));
                if let Ok(meeting) = begin_recording_session(
                    &recorder,
                    &db,
                    &app_handle,
                    meeting_id,
                    title,
                    None,
                    Vec::new(),
                    profile_id.clone(),
                    Some("Ambient Mode".to_string()),
                ) {
                    let mut state = ambient.inner.lock().unwrap();
                    state.current_meeting_id = Some(meeting.id);
                    silence_ticks = 0;
                    signal_ticks = 0;
                }
            }
        } else if detected_signal {
            silence_ticks = 0;
        } else {
            silence_ticks = silence_ticks.saturating_add(1);
            if silence_ticks >= SILENCE_TICKS_TO_STOP {
                let _ = stop_current_ambient_recording(
                    &recorder,
                    &db,
                    &transcription,
                    &app_handle,
                    &ambient,
                )
                .await;
                silence_ticks = 0;
                signal_ticks = 0;
            }
        }

        tokio::time::sleep(std::time::Duration::from_millis(LOOP_PAUSE_MS)).await;
    }
}

#[tauri::command]
pub async fn get_ambient_status(
    ambient: tauri::State<'_, AmbientController>,
) -> Result<AmbientStatus, String> {
    Ok(ambient.status())
}

#[tauri::command]
pub async fn start_ambient_capture(
    recorder: tauri::State<'_, AudioRecorder>,
    db: tauri::State<'_, Database>,
    ambient: tauri::State<'_, AmbientController>,
    transcription: tauri::State<'_, TranscriptionManager>,
    app_handle: tauri::AppHandle,
    profile_id: Option<String>,
) -> Result<String, String> {
    let stop_flag = {
        let mut state = ambient.inner.lock().unwrap();
        if state.active {
            return Err("Ambient capture is already active".to_string());
        }
        state.active = true;
        state.current_meeting_id = None;
        state.stop_flag = Arc::new(AtomicBool::new(false));
        Arc::clone(&state.stop_flag)
    };

    tauri::async_runtime::spawn(run_ambient_loop(
        recorder.inner().clone(),
        db.inner().clone(),
        transcription.inner().clone(),
        ambient.inner().clone(),
        app_handle,
        profile_id,
        stop_flag,
    ));

    Ok("Ambient listener active".to_string())
}

#[tauri::command]
pub async fn stop_ambient_capture(
    recorder: tauri::State<'_, AudioRecorder>,
    db: tauri::State<'_, Database>,
    transcription: tauri::State<'_, TranscriptionManager>,
    ambient: tauri::State<'_, AmbientController>,
    app_handle: tauri::AppHandle,
) -> Result<Option<crate::types::RecordingResult>, String> {
    let stop_flag = {
        let state = ambient.inner.lock().unwrap();
        Arc::clone(&state.stop_flag)
    };
    stop_flag.store(true, Ordering::SeqCst);

    let result = stop_current_ambient_recording(
        recorder.inner(),
        db.inner(),
        transcription.inner(),
        &app_handle,
        ambient.inner(),
    )
    .await?;

    ambient.inner.lock().unwrap().active = false;
    Ok(result)
}

#[tauri::command]
pub async fn save_last_ambient_segment(
    ambient: tauri::State<'_, AmbientController>,
) -> Result<Option<String>, String> {
    Ok(ambient.inner.lock().unwrap().last_saved_meeting_id.clone())
}
