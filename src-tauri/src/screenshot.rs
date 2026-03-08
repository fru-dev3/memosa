use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
pub struct ScreenshotTakenPayload {
    pub count: u32,
}

pub struct ScreenshotCapturer {
    inner: Arc<Mutex<CapturerInner>>,
}

struct CapturerInner {
    task: Option<tauri::async_runtime::JoinHandle<()>>,
    running: bool,
    count: u32,
    screenshots_dir: Option<PathBuf>,
    meeting_title: String,
}

impl ScreenshotCapturer {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(CapturerInner {
                task: None,
                running: false,
                count: 0,
                screenshots_dir: None,
                meeting_title: String::new(),
            })),
        }
    }
}

impl Clone for ScreenshotCapturer {
    fn clone(&self) -> Self {
        Self { inner: self.inner.clone() }
    }
}

fn ensure_screenshots_dir(meeting_folder: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(meeting_folder).join("screenshots");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create screenshots folder: {e}"))?;
    Ok(dir)
}

fn sanitize_title(title: &str) -> String {
    let s: String = title.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    // Collapse repeated underscores, trim edges
    let mut out = String::new();
    let mut last_underscore = true;
    for c in s.chars() {
        if c == '_' {
            if !last_underscore { out.push(c); }
            last_underscore = true;
        } else {
            out.push(c);
            last_underscore = false;
        }
    }
    out.trim_matches('_').to_string()
}

fn make_filename(title: &str) -> String {
    let now = chrono::Local::now();
    let time_str = now.format("%H-%M-%S").to_string();
    let safe = sanitize_title(title);
    if safe.is_empty() {
        format!("screenshot_{}.png", time_str)
    } else {
        format!("{}_{}.png", safe, time_str)
    }
}

fn take_one(dir: &PathBuf, title: &str) {
    let path = dir.join(make_filename(title));
    let _ = std::process::Command::new("screencapture")
        .args(["-x", "-t", "png"])
        .arg(&path)
        .status();
}

#[tauri::command]
pub async fn capture_screenshot_now(
    meeting_folder: String,
    meeting_title: String,
    app: tauri::AppHandle,
    capturer: tauri::State<'_, ScreenshotCapturer>,
) -> Result<(), String> {
    let dir = ensure_screenshots_dir(&meeting_folder)?;
    let count = {
        let mut inner = capturer.inner.lock().unwrap();
        inner.count += 1;
        inner.screenshots_dir = Some(dir.clone());
        inner.meeting_title = meeting_title.clone();
        inner.count
    };
    let title = meeting_title.clone();
    tauri::async_runtime::spawn_blocking(move || take_one(&dir, &title)).await.ok();
    let _ = app.emit("screenshot-taken", ScreenshotTakenPayload { count });
    Ok(())
}

#[tauri::command]
pub async fn start_screenshot_capture(
    meeting_folder: String,
    meeting_title: String,
    interval_secs: u64,
    app: tauri::AppHandle,
    capturer: tauri::State<'_, ScreenshotCapturer>,
) -> Result<(), String> {
    let dir = ensure_screenshots_dir(&meeting_folder)?;
    {
        let mut inner = capturer.inner.lock().unwrap();
        if inner.running { return Ok(()); }
        inner.running = true;
        inner.count = 0;
        inner.screenshots_dir = Some(dir.clone());
        inner.meeting_title = meeting_title.clone();
    }
    let flag = capturer.inner.clone();
    let handle = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;
            let (running, dir, title) = {
                let mut g = flag.lock().unwrap();
                if !g.running { break; }
                g.count += 1;
                (true, g.screenshots_dir.clone(), g.meeting_title.clone())
            };
            if !running { break; }
            if let Some(d) = dir {
                let t = title.clone();
                tauri::async_runtime::spawn_blocking(move || take_one(&d, &t)).await.ok();
            }
            let count = flag.lock().unwrap().count;
            let _ = app.emit("screenshot-taken", ScreenshotTakenPayload { count });
        }
    });
    capturer.inner.lock().unwrap().task = Some(handle);
    Ok(())
}

#[tauri::command]
pub async fn stop_screenshot_capture(
    capturer: tauri::State<'_, ScreenshotCapturer>,
) -> Result<(), String> {
    let mut inner = capturer.inner.lock().unwrap();
    inner.running = false;
    inner.count = 0;
    inner.screenshots_dir = None;
    inner.meeting_title = String::new();
    if let Some(handle) = inner.task.take() {
        handle.abort();
    }
    Ok(())
}
