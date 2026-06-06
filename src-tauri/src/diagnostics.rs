use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Once;

static PANIC_HOOK: Once = Once::new();

fn log_path() -> PathBuf {
    crate::paths::app_data_dir().join("startup.log")
}

pub fn log(message: impl AsRef<str>) {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(
            file,
            "{} {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            message.as_ref()
        );
    }
}

/// Redact absolute file paths from a backtrace string so that user-specific
/// directory names (home folder, project paths) are not persisted in the log.
/// Keeps only the filename and line/column information.
#[cfg(debug_assertions)]
fn redact_paths(backtrace: &str) -> String {
    // Match patterns like `/Users/someone/projects/foo/src/main.rs:42:5`
    // and replace the leading directory components with `<redacted>/`.
    let mut result = String::with_capacity(backtrace.len());
    for line in backtrace.lines() {
        // Replace absolute paths: anything starting with / up to the last /
        // before a filename. We use a simple approach: find ` at /` or `at /`
        // patterns that appear in Rust backtraces.
        let redacted = redact_absolute_paths(line);
        result.push_str(&redacted);
        result.push('\n');
    }
    result
}

/// Replace absolute paths (`/foo/bar/baz.rs`) with `<redacted>/baz.rs`.
#[cfg(debug_assertions)]
fn redact_absolute_paths(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut remaining = line;

    while let Some(slash_pos) = remaining.find('/') {
        // Push everything before the slash
        result.push_str(&remaining[..slash_pos]);

        // Find the extent of this path: consecutive non-whitespace chars
        let path_start = slash_pos;
        let path_end = remaining[path_start..]
            .find(|c: char| c.is_whitespace())
            .map(|i| path_start + i)
            .unwrap_or(remaining.len());
        let path = &remaining[path_start..path_end];

        // Extract just the filename (last component) — keep line:col suffix
        if let Some(last_sep) = path.rfind('/') {
            result.push_str("<redacted>/");
            result.push_str(&path[last_sep + 1..]);
        } else {
            result.push_str(path);
        }

        remaining = &remaining[path_end..];
    }
    result.push_str(remaining);
    result
}

pub fn install_panic_hook() {
    PANIC_HOOK.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            let location = panic_info
                .location()
                .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
                .unwrap_or_else(|| "unknown-location".to_string());

            let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "non-string panic payload".to_string()
            };

            log(format!("panic at {location}: {payload}"));

            // In debug builds, capture a redacted backtrace to the persistent log.
            // In release builds, skip backtrace capture to avoid unnecessary overhead.
            #[cfg(debug_assertions)]
            {
                let backtrace = std::backtrace::Backtrace::force_capture();
                let backtrace_str = format!("{:?}", backtrace);
                log(format!("backtrace: {}", redact_paths(&backtrace_str)));
            }

            // The default hook prints the full (unredacted) backtrace to stderr,
            // which is fine for local dev but not persisted.
            default_hook(panic_info);
        }));
    });
}
