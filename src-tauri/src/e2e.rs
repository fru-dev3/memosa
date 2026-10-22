//! Test-only driver (cargo feature `e2e`, never in release builds). Lets an
//! end-to-end script drive the real app without OS input events: it drops
//! numbered command files into `$MEMOSA_E2E_DIR`, and this thread runs them.
//!
//! - `N.js`    JavaScript evaluated in the main webview; its return value (or
//!             error) comes back as `res-N.json`.
//! - `N.size`  "WIDTH HEIGHT" in logical pixels: resizes the main window.
//! - `N.theme` "dark", "light" or "auto": the window appearance, which the
//!             webview's prefers-color-scheme follows.
//! - `pick`    if present, the next file/folder picker returns its content
//!             ("cancel" = the user cancelled) instead of opening a dialog.

use std::path::{Path, PathBuf};
use tauri::{Listener, Manager};

fn dir() -> Option<PathBuf> {
    std::env::var("MEMOSA_E2E_DIR").ok().filter(|s| !s.is_empty()).map(PathBuf::from)
}

fn write_result(d: &Path, n: &str, ok: bool, value: serde_json::Value) {
    let body = serde_json::json!({ "ok": ok, "value": value }).to_string();
    let tmp = d.join(format!("res-{n}.tmp"));
    if std::fs::write(&tmp, body).is_ok() {
        let _ = std::fs::rename(tmp, d.join(format!("res-{n}.json")));
    }
}

/// Picker override for tests: `Some(None)` = cancelled, `Some(Some(p))` = picked.
pub fn take_pick() -> Option<Option<String>> {
    let f = dir()?.join("pick");
    let s = std::fs::read_to_string(&f).ok()?;
    let _ = std::fs::remove_file(f);
    let s = s.trim().to_string();
    Some(if s == "cancel" { None } else { Some(s) })
}

pub fn start(app: &tauri::AppHandle) {
    let Some(d) = dir() else { return };
    let _ = std::fs::create_dir_all(&d);
    let rd = d.clone();
    app.listen_any("e2e-result", move |event| {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(event.payload()) {
            let n = v.get("n").and_then(|x| x.as_str()).unwrap_or("0").to_string();
            let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
            write_result(&rd, &n, ok, v.get("value").cloned().unwrap_or_default());
        }
    });
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let Ok(entries) = std::fs::read_dir(&d) else { continue };
        let mut cmds: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| matches!(p.extension().and_then(|e| e.to_str()), Some("js" | "size" | "theme")))
            .collect();
        cmds.sort();
        for p in cmds {
            let n = p.file_stem().and_then(|s| s.to_str()).unwrap_or("0").to_string();
            let body = std::fs::read_to_string(&p).unwrap_or_default();
            let _ = std::fs::remove_file(&p);
            let Some(w) = app.get_webview_window("main") else { continue };
            match p.extension().and_then(|e| e.to_str()) {
                Some("js") => {
                    let script = format!(
                        "(async () => {{ const done = (ok, value) => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {{ event: 'e2e-result', payload: {{ n: '{n}', ok, value }} }}); \
                         try {{ const r = await (async () => {{ {body} }})(); await done(true, r === undefined ? null : r); }} \
                         catch (e) {{ await done(false, String((e && e.stack) || e)); }} }})();"
                    );
                    if let Err(e) = w.eval(&script) {
                        write_result(&d, &n, false, serde_json::json!(e.to_string()));
                    }
                }
                Some("size") => {
                    let mut it = body.split_whitespace().filter_map(|x| x.parse::<f64>().ok());
                    let r = match (it.next(), it.next()) {
                        (Some(wd), Some(ht)) => w.set_size(tauri::LogicalSize::new(wd, ht)).map_err(|e| e.to_string()),
                        _ => Err("expected WIDTH HEIGHT".into()),
                    };
                    write_result(&d, &n, r.is_ok(), serde_json::json!(r.err()));
                }
                Some("theme") => {
                    let t = match body.trim() {
                        "dark" => Some(tauri::Theme::Dark),
                        "light" => Some(tauri::Theme::Light),
                        _ => None,
                    };
                    let r = w.set_theme(t).map_err(|e| e.to_string());
                    write_result(&d, &n, r.is_ok(), serde_json::json!(r.err()));
                }
                _ => {}
            }
        }
    });
}
