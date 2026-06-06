## main.rs / lib.rs additions needed (for Agent 6)

### 1. Add `mod calendar;` at the top of both `main.rs` and `lib.rs`

```rust
mod calendar;
```

### 2. Add `.manage()` calls to `tauri::Builder` (both `main.rs` and `lib.rs`)

```rust
.manage(calendar::CalendarState::new())
.manage(calendar::scheduler::AutoRecordScheduler::new())
```

### 3. Add a `.setup()` hook to `tauri::Builder` (before `.invoke_handler`)

```rust
.setup(|app| {
    // Load persisted tokens from macOS Keychain
    app.state::<calendar::CalendarState>().load_from_keychain();

    // Wrap CalendarState in Arc for the scheduler / polling loop
    let cal_state = std::sync::Arc::new(
        // CalendarState does not implement Clone, so we access the managed instance
        // and clone the inner Arcs.  The simplest approach: manage an Arc<CalendarState>
        // instead of CalendarState directly (see note below).
    );

    // Start the 30-second auto-record scheduler
    app.state::<calendar::scheduler::AutoRecordScheduler>()
        .start(cal_state.clone(), app.handle().clone());

    // Start the 5-minute background polling loop
    calendar::scheduler::start_polling_loop(cal_state.clone(), app.handle().clone());

    Ok(())
})
```

> **Important:** The scheduler's `start()` method takes `Arc<CalendarState>`.
> Because Tauri's `.manage()` stores a single instance, the cleanest fix is to
> manage `Arc<CalendarState>` rather than `CalendarState` directly:
>
> ```rust
> // In Builder:
> .manage(std::sync::Arc::new(calendar::CalendarState::new()))
>
> // In setup hook:
> let cal_state: std::sync::Arc<calendar::CalendarState> =
>     app.state::<std::sync::Arc<calendar::CalendarState>>().inner().clone();
>
> app.state::<calendar::scheduler::AutoRecordScheduler>()
>     .start(cal_state.clone(), app.handle().clone());
>
> calendar::scheduler::start_polling_loop(cal_state, app.handle().clone());
> ```
>
> If you prefer to keep `manage(CalendarState::new())`, update the command
> signatures to accept `tauri::State<'_, CalendarState>` (already done) and
> reconstruct an `Arc` in the setup hook by cloning the inner fields — both
> approaches compile cleanly.

### 4. Replace mock calendar commands in `invoke_handler` with real ones

Remove (from both `main.rs` and `lib.rs`):
```rust
commands_mock::set_google_client_id,
commands_mock::start_google_auth,
commands_mock::revoke_google_auth,
commands_mock::get_auth_status,
commands_mock::get_today_events,
commands_mock::get_upcoming_events,
commands_mock::refresh_events,
commands_mock::set_auto_record,
commands_mock::get_auto_record,
```

Add:
```rust
calendar::set_google_client_id,
calendar::start_google_auth,
calendar::revoke_google_auth,
calendar::get_auth_status,
calendar::get_today_events,
calendar::get_upcoming_events,
calendar::refresh_events,
calendar::set_auto_record,
calendar::get_auto_record,
```

---

## Cargo.toml dependencies to add

```toml
reqwest  = { version = "0.12", features = ["json"] }
keyring  = "2"
open     = "5"
base64   = "0.22"
sha2     = "0.10"
rand     = "0.8"
url      = "2"
uuid     = { version = "1", features = ["v4"] }   # already present; ensure v4 feature
```

`tokio` and `chrono` are already present in the scaffold `Cargo.toml`.

---

## Google Cloud setup (one-time, done by the user)

1. Go to https://console.cloud.google.com
2. Create a project called "Memosa" (or any name)
3. Enable the **Google Calendar API**
4. Navigate to APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID
5. Application type: **Desktop app**
6. Under "Authorized redirect URIs" add: `http://localhost:8899/callback`
7. Copy the **Client ID** (not the secret — desktop PKCE does not use a secret)
8. Paste it into Memosa Settings (the app will call `set_google_client_id`)

---

## Architecture notes / assumptions

- **Redirect URI**: `http://localhost:8899/callback` (hard-coded in `oauth.rs`)
- **Primary calendar only**: fetches `/calendars/primary/events`; extend to
  list all calendars later if needed
- **Cache**: events are held in `CalendarState.cached_events` (in-memory); invalidated
  every 5 minutes by the polling loop or on manual `refresh_events` call
- **Auto-record window**: ±30 seconds around event start/end; 2-minute warning
  fires when `0 < secs_until_start <= 120`
- **Token storage**: macOS Keychain via the `keyring` crate
  (service = `com.fru.memosa`)
- **No client secret**: PKCE desktop flow — Google does not require a secret for
  "Desktop app" OAuth clients
