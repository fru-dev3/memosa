pub mod providers;
pub mod scheduler;
pub mod state;

pub use state::CalendarState;

use crate::storage::SettingsManager;
use crate::types::{AuthStatus, CalendarEvent, CalendarProvider};
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// Return current authentication status.
#[tauri::command]
pub async fn get_auth_status(state: tauri::State<'_, CalendarState>) -> Result<AuthStatus, String> {
    crate::diagnostics::log("cmd:get_auth_status begin");
    let settings = SettingsManager::load();
    let (connected, email) = match settings.calendar_provider {
        CalendarProvider::LocalMacos => (true, Some("Apple Calendar".to_string())),
        CalendarProvider::GoogleApi => (false, None),
    };
    crate::diagnostics::log(format!("cmd:get_auth_status connected={connected}"));
    Ok(AuthStatus {
        connected,
        email,
    })
}

/// Return today's events. Uses cache; fetches from API if cache is empty.
#[tauri::command]
pub async fn get_today_events(
    state: tauri::State<'_, CalendarState>,
) -> Result<Vec<CalendarEvent>, String> {
    crate::diagnostics::log("cmd:get_today_events begin");
    // Check cache first
    {
        let cached = state.cached_events.lock().unwrap();
        if !cached.is_empty() {
            let today = chrono::Local::now().date_naive().to_string();
            let today_events: Vec<CalendarEvent> = cached
                .iter()
                .filter(|e| e.start.starts_with(&today))
                .cloned()
                .collect();
            if !today_events.is_empty() {
                crate::diagnostics::log(format!(
                    "cmd:get_today_events cache-hit={}",
                    today_events.len()
                ));
                return Ok(today_events);
            }
        }
    }

    // Cache empty or no today events — fetch from API
    let settings = SettingsManager::load();
    let events = providers::get_events_for_provider(&settings.calendar_provider, &state, 1).await?;
    let today = chrono::Local::now().date_naive().to_string();
    let events: Vec<CalendarEvent> = events
        .into_iter()
        .filter(|event| event.start.starts_with(&today))
        .collect();
    crate::diagnostics::log(format!("cmd:get_today_events fetched={}", events.len()));

    // Merge into cache (don't overwrite upcoming events)
    {
        let mut cached = state.cached_events.lock().unwrap();
        for ev in &events {
            if !cached.iter().any(|e| e.id == ev.id) {
                cached.push(ev.clone());
            }
        }
    }

    Ok(events)
}

/// Return events over the next `days` days.
#[tauri::command]
pub async fn get_upcoming_events(
    days: u32,
    state: tauri::State<'_, CalendarState>,
) -> Result<Vec<CalendarEvent>, String> {
    let settings = SettingsManager::load();
    let events = providers::get_events_for_provider(&settings.calendar_provider, &state, days).await?;

    *state.cached_events.lock().unwrap() = events.clone();
    Ok(events)
}

/// Manually refresh the event cache and emit `calendar-events-updated`.
#[tauri::command]
pub async fn refresh_events(
    state: tauri::State<'_, CalendarState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let settings = SettingsManager::load();
    let events = providers::get_events_for_provider(&settings.calendar_provider, &state, 7).await?;

    *state.cached_events.lock().unwrap() = events.clone();
    app_handle
        .emit(
            "calendar-events-updated",
            serde_json::json!({ "events": events }),
        )
        .ok();

    Ok(())
}

/// Enable or disable auto-record.
#[tauri::command]
pub async fn set_auto_record(
    enabled: bool,
    state: tauri::State<'_, CalendarState>,
) -> Result<(), String> {
    *state.auto_record.lock().unwrap() = enabled;
    let mut settings = SettingsManager::load();
    settings.auto_record = enabled;
    SettingsManager::save(&settings)?;
    Ok(())
}

/// Return the current auto-record setting.
#[tauri::command]
pub async fn get_auto_record(state: tauri::State<'_, CalendarState>) -> Result<bool, String> {
    let enabled = *state.auto_record.lock().unwrap();
    crate::diagnostics::log(format!("cmd:get_auto_record enabled={enabled}"));
    Ok(enabled)
}

/// Skip auto-record once for a specific event ID.
#[tauri::command]
pub async fn skip_auto_record_once(
    event_id: String,
    state: tauri::State<'_, CalendarState>,
) -> Result<(), String> {
    state.skipped_once_events.lock().unwrap().insert(event_id);
    Ok(())
}
