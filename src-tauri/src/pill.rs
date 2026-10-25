//! The floating recorder: a small always-on-top window shown while recording, so
//! the main window can be hidden and the screen used for the call. It is the same
//! web app at `?view=pill`; it talks to the main window through app events.

use tauri::{LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "pill";
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 96.0;

/// Show the recorder near the top right of the screen. `started` is the
/// recording's start (ms since epoch) so its clock matches the main window's.
#[tauri::command]
pub fn pill_show(app: tauri::AppHandle, started: f64, title: String) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        return Ok(());
    }
    let q = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    let url = format!("index.html?view=pill&started={}&title={}", started as u64, q(&title));
    let w = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::App(url.into()))
        .title("Memosa recording")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .shadow(true)
        .build()
        .map_err(|e| e.to_string())?;
    if let Ok(Some(m)) = w.current_monitor() {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let pos = m.position().to_logical::<f64>(scale);
        let _ = w.set_position(tauri::LogicalPosition::new(pos.x + size.width - WIDTH - 24.0, pos.y + 40.0));
    }
    Ok(())
}

#[tauri::command]
pub fn pill_close(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
}

/// Grow the recorder while its tag list is open, shrink it back after.
#[tauri::command]
pub fn pill_resize(app: tauri::AppHandle, height: f64) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_size(LogicalSize::new(WIDTH, height.clamp(56.0, 420.0)));
    }
}
