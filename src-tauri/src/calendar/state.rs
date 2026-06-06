use crate::types::CalendarEvent;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct CalendarState {
    pub auto_record: Arc<Mutex<bool>>,
    pub cached_events: Arc<Mutex<Vec<CalendarEvent>>>,
    pub skipped_once_events: Arc<Mutex<HashSet<String>>>,
}

impl CalendarState {
    pub fn new() -> Self {
        Self {
            auto_record: Arc::new(Mutex::new(false)),
            cached_events: Arc::new(Mutex::new(Vec::new())),
            skipped_once_events: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}
