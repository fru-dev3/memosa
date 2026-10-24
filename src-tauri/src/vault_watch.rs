//! Live refresh: watch the vault folder (FSEvents on macOS) and tell the UI when
//! files change, whoever changed them (Finder, another AI, a sync tool, this app).
//! Events are debounced into one `vault_changed` per quiet 300 ms. Changes inside
//! `.memosa/` (index, trash bookkeeping) are ignored.

use notify::{RecursiveMode, Watcher};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Emitter;

static WATCHER: Mutex<Option<notify::RecommendedWatcher>> = Mutex::new(None);
static LAST_EVENT: Mutex<Option<Instant>> = Mutex::new(None);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

fn relevant(event: &notify::Event) -> bool {
    event.paths.iter().any(|p| {
        !p.components().any(|c| c.as_os_str() == ".memosa")
            && !p.file_name().map(|n| n.to_string_lossy().ends_with(".tmp")).unwrap_or(false)
    })
}

/// (Re)start watching the current vault root. Safe to call any number of times.
pub fn restart(app: &tauri::AppHandle) {
    if APP.set(app.clone()).is_ok() {
        // One debounce thread for the life of the app.
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_millis(150));
            let fire = {
                let mut last = LAST_EVENT.lock().unwrap();
                match *last {
                    Some(t) if t.elapsed() >= Duration::from_millis(300) => {
                        *last = None;
                        true
                    }
                    _ => false,
                }
            };
            if fire {
                if let Some(app) = APP.get() {
                    let _ = app.emit("vault_changed", ());
                }
            }
        });
    }
    let root = crate::vault_cmds::vault_root();
    let _ = std::fs::create_dir_all(&root);
    let mut guard = WATCHER.lock().unwrap();
    *guard = None; // stop the previous watcher first
    let made = notify::recommended_watcher(|res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            if relevant(&event) {
                *LAST_EVENT.lock().unwrap() = Some(Instant::now());
            }
        }
    });
    match made {
        Ok(mut w) => match w.watch(&root, RecursiveMode::Recursive) {
            Ok(()) => *guard = Some(w),
            Err(e) => crate::diagnostics::log(format!("vault watch failed: {e}")),
        },
        Err(e) => crate::diagnostics::log(format!("vault watcher not created: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_index_and_temp_files() {
        let ev = |p: &str| notify::Event::new(notify::EventKind::Any).add_path(p.into());
        assert!(relevant(&ev("/v/Work/2026-10-22-sync/notes.md")));
        assert!(!relevant(&ev("/v/.memosa/index/embeddings.jsonl")));
        assert!(!relevant(&ev("/v/Work/x/meta.json.tmp")));
    }
}
