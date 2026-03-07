mod audio;
mod calendar;
mod diagnostics;
mod export;
#[cfg(target_os = "macos")]
mod macos;
mod storage;
mod transcription;
mod types;

use audio::AudioRecorder;
use audio::AmbientController;
use calendar::{scheduler::AutoRecordScheduler, CalendarState};
use std::sync::atomic::{AtomicBool, Ordering};
use storage::{Database, SettingsManager};
use tauri::Manager;
use transcription::TranscriptionManager;

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(format!("Blocked non-http URL: {url}"));
    }
    #[cfg(target_os = "macos")]
    {
        crate::macos::open_url(&url)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(format!("Cannot open URL on this platform: {url}"))
    }
}

#[derive(Default)]
struct ShutdownState {
    closing: AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook();
    diagnostics::log("run: start");

    let calendar_state = CalendarState::new();
    diagnostics::log("run: calendar state created");
    let audio_recorder = AudioRecorder::new();
    diagnostics::log("run: audio recorder created");
    let ambient_controller = AmbientController::new();
    diagnostics::log("run: ambient controller created");
    let transcription_manager = TranscriptionManager::new();
    diagnostics::log("run: transcription manager created");
    let database = Database::new().expect("Failed to initialize database");
    diagnostics::log("run: database initialized");
    let scheduler = AutoRecordScheduler::new();
    diagnostics::log("run: scheduler created");

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(audio_recorder.clone())
        .manage(ambient_controller.clone())
        .manage(transcription_manager.clone())
        .manage(calendar_state.clone())
        .manage(scheduler)
        .manage(database.clone())
        .manage(ShutdownState::default())
        .setup(move |app| {
            diagnostics::log("setup: begin");
            *calendar_state.auto_record.lock().unwrap() = SettingsManager::load().auto_record;
            diagnostics::log("setup: settings loaded");

            diagnostics::log("setup: calendar scheduler disabled for stability");

            diagnostics::log("setup: native tray and shortcut registration disabled for stability");

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let recorder = window.state::<AudioRecorder>();
                if !recorder.get_status().is_recording {
                    return;
                }

                let shutdown = window.state::<ShutdownState>();
                if shutdown.closing.swap(true, Ordering::SeqCst) {
                    return;
                }

                api.prevent_close();

                let app_handle = window.app_handle().clone();
                let db = window.state::<Database>();
                let transcription = window.state::<TranscriptionManager>();

                if let Err(error) = audio::recorder::finalize_recording_session(
                    recorder.inner(),
                    db.inner(),
                    transcription.inner(),
                    &app_handle,
                ) {
                    eprintln!("[app] Failed to finalize recording during shutdown: {error}");
                }

                if let Err(error) = window.close() {
                    eprintln!("[app] Failed to close window after finalizing recording: {error}");
                    shutdown.closing.store(false, Ordering::SeqCst);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            audio::recorder::start_recording,
            audio::recorder::stop_recording,
            audio::recorder::get_recording_status,
            audio::recorder::get_input_devices,
            audio::recorder::get_audio_diagnostics,
            audio::recorder::test_microphone_input,
            audio::recorder::test_system_audio_input,
            audio::ambient::get_ambient_status,
            audio::ambient::start_ambient_capture,
            audio::ambient::stop_ambient_capture,
            audio::ambient::save_last_ambient_segment,
            transcription::get_available_models,
            transcription::download_model,
            transcription::transcribe_audio,
            transcription::get_transcription_status,
            transcription::cancel_transcription,
            calendar::get_auth_status,
            calendar::get_today_events,
            calendar::get_upcoming_events,
            calendar::refresh_events,
            calendar::set_auto_record,
            calendar::get_auto_record,
            calendar::skip_auto_record_once,
            storage::get_meetings,
            storage::get_meeting,
            storage::search_meetings,
            storage::delete_meeting,
            storage::get_storage_path,
            storage::set_storage_path,
            storage::get_settings,
            storage::save_settings,
            storage::get_storage_usage,
            storage::preview_cleanup,
            storage::run_cleanup_now,
            storage::open_meeting_folder,
            storage::read_meeting_transcript,
            storage::read_meeting_notes,
            storage::save_meeting_notes,
            storage::save_meeting_transcript,
            storage::get_meeting_audio_status,
            storage::pick_storage_folder,
            storage::rename_meeting,
            storage::update_meeting_profile,
            storage::load_profiles,
            storage::save_profiles,
            storage::save_text_file,
            export::export_meeting_bundle,
            get_app_version,
            open_external_url,
        ])
        .run({
            diagnostics::log("run: entering tauri runtime");
            tauri::generate_context!()
        })
        .expect("error while running tauri application");
}
