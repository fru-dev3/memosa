mod audio;
mod diagnostics;
mod export;
mod import;
#[cfg(target_os = "macos")]
mod macos;
pub mod paths;
mod storage;
mod transcription;
mod types;

use audio::AudioRecorder;
use std::sync::atomic::{AtomicBool, Ordering};
use storage::{Database, SettingsManager};
use tauri::{Manager, RunEvent};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder};
use tauri::menu::{Menu, MenuItem};
use transcription::{LiveTranscriber, TranscriptionManager};

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
fn start_window_drag(window: tauri::Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
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

    let audio_recorder = AudioRecorder::new();
    diagnostics::log("run: audio recorder created");
    let transcription_manager = TranscriptionManager::new();
    diagnostics::log("run: transcription manager created");
    let database = match Database::new() {
        Ok(db) => db,
        Err(e) => {
            eprintln!("[memosa] Fatal: failed to initialize database: {e}");
            diagnostics::log(format!("FATAL: database init failed: {e}"));
            std::process::exit(1);
        }
    };
    diagnostics::log("run: database initialized");
    let live_transcriber = LiveTranscriber::new();
    diagnostics::log("run: live transcriber created");
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(audio_recorder.clone())
        .manage(transcription_manager.clone())
        .manage(live_transcriber)
        .manage(database.clone())
        .manage(ShutdownState::default())
        .setup(move |app| {
            diagnostics::log("setup: begin");

            // --- Global shortcuts & launch-at-login ---
            // Both features are disabled for stability during pre-App-Store development.
            diagnostics::log("setup: global shortcuts and launch-at-login not registered (disabled for pre-release stability)");

            // --- System tray (menu bar icon) ---
            let show_item = MenuItem::with_id(app, "show", "Show Memosa", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Memosa", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .icon_as_template(true)
                .tooltip("Memosa")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            diagnostics::log("setup: system tray created");

            // Scheduled retention cleanup -- runs once per day if policy is enabled.
            let cleanup_db = database.clone();
            let cleanup_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait 60 seconds after startup before the first check, then repeat daily.
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                loop {
                    let settings = storage::SettingsManager::load();
                    if settings.retention_policy.enabled {
                        diagnostics::log("scheduled cleanup: running retention policy");
                        match storage::run_scheduled_cleanup(&cleanup_db, &cleanup_app).await {
                            Ok(result) => diagnostics::log(format!(
                                "scheduled cleanup: archived={} deleted={} reclaimed={}B",
                                result.archived, result.meetings_deleted, result.reclaimed_bytes
                            )),
                            Err(e) => diagnostics::log(format!("scheduled cleanup error: {e}")),
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(24 * 60 * 60)).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let recorder = window.state::<AudioRecorder>();
                if recorder.get_status().is_recording {
                    // Recording in progress — finalize it, then actually close.
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
                } else {
                    // Not recording — hide window to tray instead of quitting.
                    // User can re-show via tray icon click or "Show Memosa" menu.
                    // Use "Quit Memosa" from the tray menu to actually exit.
                    api.prevent_close();
                    let _ = window.hide();
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
            transcription::get_available_models,
            transcription::download_model,
            transcription::delete_model,
            transcription::transcribe_audio,
            transcription::get_transcription_status,
            transcription::cancel_transcription,
            transcription::start_live_transcription,
            transcription::stop_live_transcription,
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
            storage::set_meeting_favorite,
            storage::get_cleanup_log,
            storage::load_profiles,
            storage::save_profiles,
            storage::save_text_file,
            storage::get_folders,
            storage::save_folder,
            storage::delete_folder_record,
            storage::save_all_folders,
            storage::get_folder_assignments,
            storage::assign_meeting_folder,
            storage::remove_meeting_folder,
            export::export_meeting_bundle,
            export::export_meetings_markdown,
            export::reveal_export_in_finder,
            import::pick_import_folder,
            import::scan_voice_memos,
            import::import_voice_memos,
            get_app_version,
            open_external_url,
            start_window_drag,
        ])
        .build({
            diagnostics::log("run: entering tauri runtime");
            tauri::generate_context!()
        })
        .unwrap_or_else(|e| {
            eprintln!("[memosa] Fatal: tauri runtime error: {e}");
            diagnostics::log(format!("FATAL: tauri runtime error: {e}"));
            std::process::exit(1);
        })
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { api, .. } = &event {
                let recorder = app_handle.state::<AudioRecorder>();
                if recorder.get_status().is_recording {
                    diagnostics::log("exit-requested: recording active, finalizing before exit");
                    api.prevent_exit();

                    let db = app_handle.state::<Database>();
                    let transcription = app_handle.state::<TranscriptionManager>();

                    if let Err(e) = audio::recorder::finalize_recording_session(
                        recorder.inner(),
                        db.inner(),
                        transcription.inner(),
                        app_handle,
                    ) {
                        eprintln!("[app] Failed to finalize recording during Cmd+Q exit: {e}");
                        diagnostics::log(format!("exit-requested: finalize error: {e}"));
                    } else {
                        diagnostics::log("exit-requested: recording finalized successfully");
                    }

                    app_handle.exit(0);
                }
            }
        });
}
