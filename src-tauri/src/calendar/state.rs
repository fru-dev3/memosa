use crate::types::CalendarEvent;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct CalendarState {
    pub auto_record: Arc<Mutex<bool>>,
    pub cached_events: Arc<Mutex<Vec<CalendarEvent>>>,
    pub skipped_once_events: Arc<Mutex<HashSet<String>>>,
    /// Cached Google access token + its unix-second expiry. Refreshed on demand
    /// from the Keychain-stored refresh token. Never persisted to disk.
    pub access_token: Arc<Mutex<Option<(String, i64)>>>,
}

impl CalendarState {
    pub fn new() -> Self {
        Self {
            auto_record: Arc::new(Mutex::new(false)),
            cached_events: Arc::new(Mutex::new(Vec::new())),
            skipped_once_events: Arc::new(Mutex::new(HashSet::new())),
            access_token: Arc::new(Mutex::new(None)),
        }
    }

    /// Hydrate runtime state from persisted settings on startup.
    pub fn hydrate_from_settings(&self) {
        let settings = crate::storage::SettingsManager::load();
        *self.auto_record.lock().unwrap() = settings.auto_record;
    }
}
