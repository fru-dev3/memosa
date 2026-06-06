use crate::types::CalendarEvent;
use chrono::{Local, NaiveDateTime, TimeZone};
use serde_json::Value;

const CALENDAR_API_BASE: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

pub struct GoogleCalendarClient {
    access_token: String,
}

impl GoogleCalendarClient {
    pub fn new(access_token: String) -> Self {
        Self { access_token }
    }

    /// Fetch events for today (midnight to 23:59:59 local time).
    pub async fn get_today_events(&self) -> Result<Vec<CalendarEvent>, String> {
        let today = Local::now().date_naive();
        let from = today
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| "Failed to build start of day".to_string())?;
        let to = today
            .and_hms_opt(23, 59, 59)
            .ok_or_else(|| "Failed to build end of day".to_string())?;
        self.get_events_in_range(from, to).await
    }

    /// Return the primary calendar's id, which for Google is the account email.
    /// Used only to show "connected as <email>" in the UI.
    pub async fn get_primary_email(&self) -> Result<Option<String>, String> {
        let client = reqwest::Client::new();
        let response = client
            .get("https://www.googleapis.com/calendar/v3/calendars/primary")
            .bearer_auth(&self.access_token)
            .send()
            .await
            .map_err(|e| format!("Primary calendar request failed: {}", e))?;
        if !response.status().is_success() {
            return Ok(None);
        }
        let body: Value = response.json().await.map_err(|e| e.to_string())?;
        Ok(body.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
    }

    /// Fetch events for the next `days` days.
    pub async fn get_upcoming_events(&self, days: u32) -> Result<Vec<CalendarEvent>, String> {
        let from = Local::now().naive_local();
        let to = from + chrono::Duration::days(days as i64);
        self.get_events_in_range(from, to).await
    }

    async fn get_events_in_range(
        &self,
        from: NaiveDateTime,
        to: NaiveDateTime,
    ) -> Result<Vec<CalendarEvent>, String> {
        // Convert NaiveDateTime (local) to DateTime<Utc> for the API
        let from_dt = Local
            .from_local_datetime(&from)
            .single()
            .ok_or_else(|| "Ambiguous local time for from".to_string())?;
        let to_dt = Local
            .from_local_datetime(&to)
            .single()
            .ok_or_else(|| "Ambiguous local time for to".to_string())?;

        let time_min = from_dt.to_rfc3339();
        let time_max = to_dt.to_rfc3339();

        let client = reqwest::Client::new();
        let response = client
            .get(CALENDAR_API_BASE)
            .bearer_auth(&self.access_token)
            .query(&[
                ("timeMin", time_min.as_str()),
                ("timeMax", time_max.as_str()),
                ("singleEvents", "true"),
                ("orderBy", "startTime"),
                ("maxResults", "250"),
            ])
            .send()
            .await
            .map_err(|e| format!("Calendar API request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Calendar API error ({}): {}", status, body));
        }

        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Calendar API response: {}", e))?;

        let items = body
            .get("items")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "No items array in response".to_string())?;

        let events: Vec<CalendarEvent> = items.iter().filter_map(Self::parse_event).collect();

        Ok(events)
    }

    fn parse_event(item: &Value) -> Option<CalendarEvent> {
        let id = item.get("id")?.as_str()?.to_string();

        // Use summary as title; fall back to "(No title)"
        let title = item
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("(No title)")
            .to_string();

        // Events can have dateTime (timed) or date (all-day)
        let start = item
            .get("start")
            .and_then(|s| s.get("dateTime").or_else(|| s.get("date")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())?;

        let end = item
            .get("end")
            .and_then(|e| e.get("dateTime").or_else(|| e.get("date")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())?;

        let attendees: Vec<String> = item
            .get("attendees")
            .and_then(|a| a.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.get("email").and_then(|e| e.as_str()))
                    .map(|s| s.to_string())
                    .collect()
            })
            .unwrap_or_default();

        let location = item
            .get("location")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let description = item
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // calendar_name: use organizer displayName or "primary"
        let calendar_name = item
            .get("organizer")
            .and_then(|o| o.get("displayName").or_else(|| o.get("email")))
            .and_then(|v| v.as_str())
            .unwrap_or("primary")
            .to_string();

        Some(CalendarEvent {
            id,
            title,
            start,
            end,
            attendees,
            location,
            description,
            calendar_name,
            recording_candidate: false,
            candidate_reason: None,
            meeting_platform: None,
        })
    }
}
