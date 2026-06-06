//! Secure storage for Google Calendar OAuth tokens.
//!
//! The long-lived refresh token lives in the macOS Keychain (never on disk in
//! plaintext); short-lived access tokens are cached in memory only. This is the
//! fix for the security concern that originally kept the calendar feature
//! unreleased.

use crate::calendar::oauth;
use crate::calendar::state::CalendarState;
use keyring::Entry;

const SERVICE: &str = "com.memosa.app";
const REFRESH_ACCOUNT: &str = "google_calendar_refresh_token";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, REFRESH_ACCOUNT).map_err(|e| format!("Keychain entry error: {e}"))
}

/// Persist the Google refresh token in the macOS Keychain.
pub fn save_refresh_token(token: &str) -> Result<(), String> {
    entry()?
        .set_password(token)
        .map_err(|e| format!("Keychain save error: {e}"))
}

/// Load the refresh token, or `None` if the user is not connected.
pub fn load_refresh_token() -> Option<String> {
    entry().ok()?.get_password().ok()
}

/// Remove the stored refresh token (on disconnect).
pub fn clear_refresh_token() -> Result<(), String> {
    match entry()?.delete_password() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Keychain delete error: {e}")),
    }
}

/// Return a valid (non-expired) access token, refreshing it via the stored
/// refresh token when necessary. Errors if the user is not connected or no
/// client ID is configured.
pub async fn get_access_token(state: &CalendarState, client_id: &str) -> Result<String, String> {
    let now = chrono::Utc::now().timestamp();

    // Reuse the cached token if it has more than 60s of life left.
    if let Some((tok, exp)) = state.access_token.lock().unwrap().as_ref() {
        if *exp - 60 > now {
            return Ok(tok.clone());
        }
    }

    if client_id.is_empty() {
        return Err("Google client ID is not set".to_string());
    }
    let refresh = load_refresh_token()
        .ok_or_else(|| "Not connected to Google Calendar".to_string())?;

    let resp = oauth::refresh_access_token(client_id, &refresh).await?;
    let exp = now + resp.expires_in as i64;
    *state.access_token.lock().unwrap() = Some((resp.access_token.clone(), exp));

    // Google may rotate the refresh token; persist the new one if provided.
    if let Some(new_refresh) = resp.refresh_token {
        let _ = save_refresh_token(&new_refresh);
    }

    Ok(resp.access_token)
}
