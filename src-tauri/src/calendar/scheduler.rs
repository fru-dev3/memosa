use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use tauri::Emitter;
use tokio::time::{sleep, Duration};

use crate::audio::recorder::{begin_recording_session, finalize_recording_session};
use crate::audio::AudioRecorder;
use crate::calendar::state::CalendarState;
use crate::storage::Database;
use crate::transcription::TranscriptionManager;

pub struct AutoRecordScheduler {
    running: Arc<Mutex<bool>>,
    warned_events: Arc<Mutex<HashSet<String>>>,
    active_recordings: Arc<Mutex<HashMap<String, String>>>,
}

impl AutoRecordScheduler {
    pub fn new() -> Self {
        Self {
            running: Arc::new(Mutex::new(false)),
            warned_events: Arc::new(Mutex::new(HashSet::new())),
            active_recordings: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn start(
        &self,
        calendar_state: CalendarState,
        recorder: AudioRecorder,
        db: Database,
        transcription: TranscriptionManager,
        app_handle: tauri::AppHandle,
    ) {
        let running = Arc::clone(&self.running);
        let warned_events = Arc::clone(&self.warned_events);
        let active_recordings = Arc::clone(&self.active_recordings);

        tauri::async_runtime::spawn(async move {
            *running.lock().unwrap() = true;

            loop {
                if !*running.lock().unwrap() {
                    break;
                }

                if *calendar_state.auto_record.lock().unwrap() {
                    Self::check_and_schedule(
                        &calendar_state,
                        &recorder,
                        &db,
                        &transcription,
                        &app_handle,
                        &warned_events,
                        &active_recordings,
                    )
                    .await;
                }

                sleep(Duration::from_secs(30)).await;
            }
        });
    }

    async fn check_and_schedule(
        state: &CalendarState,
        recorder: &AudioRecorder,
        db: &Database,
        transcription: &TranscriptionManager,
        app_handle: &tauri::AppHandle,
        warned_events: &Arc<Mutex<HashSet<String>>>,
        active_recordings: &Arc<Mutex<HashMap<String, String>>>,
    ) {
        let events = state.cached_events.lock().unwrap().clone();
        let live_ids: HashSet<String> = events.iter().map(|event| event.id.clone()).collect();

        warned_events
            .lock()
            .unwrap()
            .retain(|event_id| live_ids.contains(event_id));
        state
            .skipped_once_events
            .lock()
            .unwrap()
            .retain(|event_id| live_ids.contains(event_id));
        active_recordings
            .lock()
            .unwrap()
            .retain(|event_id, _| live_ids.contains(event_id));

        let now = chrono::Utc::now();

        for event in events {
            let skip_once = state
                .skipped_once_events
                .lock()
                .unwrap()
                .contains(&event.id);
            let start = chrono::DateTime::parse_from_rfc3339(&event.start)
                .ok()
                .map(|value| value.with_timezone(&chrono::Utc));
            let end = chrono::DateTime::parse_from_rfc3339(&event.end)
                .ok()
                .map(|value| value.with_timezone(&chrono::Utc));

            if let (Some(start), Some(end)) = (start, end) {
                let secs_until_start = (start - now).num_seconds();
                let secs_since_start = (now - start).num_seconds();
                let secs_since_end = (now - end).num_seconds();

                if secs_until_start > 0 && secs_until_start <= 120 && !skip_once {
                    let mut warned = warned_events.lock().unwrap();
                    if warned.insert(event.id.clone()) {
                        let _ = app_handle.emit(
                            "auto-record-warning",
                            serde_json::json!({
                                "event": event.clone(),
                                "seconds_until": secs_until_start,
                            }),
                        );
                    }
                } else if secs_until_start > 120 || secs_until_start <= 0 {
                    warned_events.lock().unwrap().remove(&event.id);
                }

                if secs_until_start <= 0 && secs_since_start < 30 && !skip_once {
                    let already_started = active_recordings.lock().unwrap().contains_key(&event.id);
                    if !already_started {
                        let meeting_id = format!("cal-{}-{}", event.id, start.timestamp());
                        match begin_recording_session(
                            recorder,
                            db,
                            app_handle,
                            meeting_id.clone(),
                            event.title.clone(),
                            Some(&event.id),
                            event.attendees.clone(),
                            None,
                            None, // source_app — not applicable for calendar auto-record
                        ) {
                            Ok(meeting) => {
                                active_recordings
                                    .lock()
                                    .unwrap()
                                    .insert(event.id.clone(), meeting.id.clone());
                                let _ = app_handle.emit(
                                    "auto-record-started",
                                    serde_json::json!({
                                        "meeting_id": meeting.id,
                                        "event_id": event.id,
                                    }),
                                );
                            }
                            Err(error) => {
                                eprintln!("[calendar] auto-record start failed: {error}");
                            }
                        }
                    }
                }

                if secs_since_end >= 0 && secs_since_end < 30 {
                    let meeting_id = active_recordings.lock().unwrap().get(&event.id).cloned();
                    if let Some(meeting_id) = meeting_id {
                        let status = recorder.get_status();
                        if status.is_recording
                            && status.meeting_id.as_deref() == Some(meeting_id.as_str())
                        {
                            match finalize_recording_session(
                                recorder,
                                db,
                                transcription,
                                app_handle,
                            ) {
                                Ok(result) => {
                                    let _ = app_handle.emit(
                                        "auto-record-stopped",
                                        serde_json::json!({
                                            "meeting_id": result.meeting_id,
                                        }),
                                    );
                                }
                                Err(error) => {
                                    eprintln!("[calendar] auto-record stop failed: {error}");
                                }
                            }
                        }

                        active_recordings.lock().unwrap().remove(&event.id);
                    }
                    state.skipped_once_events.lock().unwrap().remove(&event.id);
                }
            }
        }
    }

    #[allow(dead_code)]
    pub fn stop(&self) {
        *self.running.lock().unwrap() = false;
    }
}

