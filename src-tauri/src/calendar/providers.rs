use crate::types::{CalendarEvent, CalendarProvider};

fn detect_platform(text: &str) -> Option<(&'static str, &'static str)> {
    let lower = text.to_lowercase();
    if lower.contains("zoom.us") || lower.contains("zoom meeting") {
        return Some(("Zoom", "Contains a Zoom meeting link"));
    }
    if lower.contains("meet.google.com") || lower.contains("google meet") {
        return Some(("Google Meet", "Contains a Google Meet link"));
    }
    if lower.contains("teams.microsoft.com") || lower.contains("microsoft teams") || lower.contains("teams meeting") {
        return Some(("Microsoft Teams", "Contains a Teams meeting link"));
    }
    if lower.contains("slack") && lower.contains("call") {
        return Some(("Slack", "Looks like a Slack call"));
    }
    if lower.contains("phone") || lower.contains("dial in") || lower.contains("dial-in") {
        return Some(("Phone", "Looks like a phone meeting"));
    }
    None
}

fn classify_event(mut event: CalendarEvent) -> CalendarEvent {
    let combined = [
        event.title.clone(),
        event.location.clone().unwrap_or_default(),
        event.description.clone().unwrap_or_default(),
    ]
    .join("\n");

    if let Some((platform, reason)) = detect_platform(&combined) {
        event.recording_candidate = true;
        event.candidate_reason = Some(reason.to_string());
        event.meeting_platform = Some(platform.to_string());
    }

    event
}

pub async fn get_events_for_provider(
    provider: &CalendarProvider,
    state: &crate::calendar::CalendarState,
    days: u32,
) -> Result<Vec<CalendarEvent>, String> {
    let events = match provider {
        CalendarProvider::GoogleApi => Vec::new(),
        CalendarProvider::LocalMacos => get_local_macos_events(days)?,
    };

    Ok(events.into_iter().map(classify_event).collect())
}

// Local macOS Calendar integration via osascript/JXA is not available in the
// MAS sandbox (requires com.apple.security.automation.apple-events + temporary
// exception entitlement for com.apple.iCal, which Apple rarely grants for v1
// submissions). Use Google Calendar instead (Settings → Calendar Provider).
fn get_local_macos_events(_days: u32) -> Result<Vec<CalendarEvent>, String> {
    Ok(Vec::new())
}
