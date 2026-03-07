use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Once;

static PANIC_HOOK: Once = Once::new();

fn log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("startup.log")
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
            log(format!(
                "backtrace: {:?}",
                std::backtrace::Backtrace::force_capture()
            ));

            default_hook(panic_info);
        }));
    });
}
