pub mod google;
pub mod oauth;
pub mod providers;
pub mod scheduler;
pub mod state;
pub mod tokens;

pub use state::CalendarState;

use crate::storage::SettingsManager;
use crate::types::{AuthStatus, CalendarEvent, CalendarProvider};
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// Return current authentication status.
#[tauri::command]
pub async fn get_auth_status(
    _state: tauri::State<'_, CalendarState>,
) -> Result<AuthStatus, String> {
    crate::diagnostics::log("cmd:get_auth_status begin");
    let settings = SettingsManager::load();
    let (connected, email) = match settings.calendar_provider {
        CalendarProvider::LocalMacos => (true, Some("Apple Calendar".to_string())),
        CalendarProvider::GoogleApi => (
            tokens::load_refresh_token().is_some(),
            settings.calendar_account_email,
        ),
    };
    crate::diagnostics::log(format!("cmd:get_auth_status connected={connected}"));
    Ok(AuthStatus { connected, email })
}

/// Persist the user's Google OAuth desktop client ID (not a secret under PKCE).
#[tauri::command]
pub async fn set_google_client_id(client_id: String) -> Result<(), String> {
    let mut settings = SettingsManager::load();
    settings.google_client_id = client_id.trim().to_string();
    SettingsManager::save(&settings)
}

/// Run the full PKCE OAuth flow: open the browser, capture the redirect on a
/// loopback port, exchange the code, and store the refresh token in the Keychain.
/// Returns the connected account email (best-effort).
#[tauri::command]
pub async fn start_google_auth(
    state: tauri::State<'_, CalendarState>,
) -> Result<AuthStatus, String> {
    crate::diagnostics::log("cmd:start_google_auth begin");
    let settings = SettingsManager::load();
    let client_id = settings.google_client_id.clone();
    if client_id.is_empty() {
        return Err("Set your Google client ID first.".to_string());
    }

    let pkce = oauth::generate_pkce();
    let auth_url = oauth::build_auth_url(&client_id, &pkce);

    // Start the loopback callback listener BEFORE opening the browser so we
    // never miss the redirect.
    let server = tauri::async_runtime::spawn_blocking(oauth::start_local_callback_server_blocking);

    #[cfg(target_os = "macos")]
    crate::macos::open_url(&auth_url)?;
    #[cfg(not(target_os = "macos"))]
    return Err("OAuth is only supported on macOS in this build.".to_string());

    let code = server
        .await
        .map_err(|e| format!("Callback server task failed: {e}"))??;

    let token = oauth::exchange_code(&client_id, &code, &pkce.verifier).await?;

    let refresh = token
        .refresh_token
        .clone()
        .ok_or_else(|| "Google did not return a refresh token.".to_string())?;
    tokens::save_refresh_token(&refresh)?;

    // Cache the access token immediately.
    let exp = chrono::Utc::now().timestamp() + token.expires_in as i64;
    *state.access_token.lock().unwrap() = Some((token.access_token.clone(), exp));

    // Best-effort: the "primary" calendar id is the account email.
    let email = google::GoogleCalendarClient::new(token.access_token.clone())
        .get_primary_email()
        .await
        .ok()
        .flatten();
    let mut settings = SettingsManager::load();
    settings.calendar_account_email = email.clone();
    settings.calendar_provider = CalendarProvider::GoogleApi;
    SettingsManager::save(&settings)?;

    crate::diagnostics::log("cmd:start_google_auth success");
    Ok(AuthStatus {
        connected: true,
        email,
    })
}

/// Disconnect: clear the Keychain token, cached access token, and stored email.
#[tauri::command]
pub async fn revoke_google_auth(state: tauri::State<'_, CalendarState>) -> Result<(), String> {
    tokens::clear_refresh_token()?;
    *state.access_token.lock().unwrap() = None;
    state.cached_events.lock().unwrap().clear();
    let mut settings = SettingsManager::load();
    settings.calendar_account_email = None;
    SettingsManager::save(&settings)?;
    crate::diagnostics::log("cmd:revoke_google_auth done");
    Ok(())
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
    let excluded = &settings.excluded_calendar_names;
    let events: Vec<CalendarEvent> = events
        .into_iter()
        .filter(|event| event.start.starts_with(&today) && !excluded.contains(&event.calendar_name))
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
    let excluded = &settings.excluded_calendar_names;
    let events = providers::get_events_for_provider(&settings.calendar_provider, &state, days).await?;
    let events: Vec<CalendarEvent> = events
        .into_iter()
        .filter(|event| !excluded.contains(&event.calendar_name))
        .collect();
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
