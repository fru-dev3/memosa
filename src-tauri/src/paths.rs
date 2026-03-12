use std::path::PathBuf;

/// Returns the app's data directory following Apple guidelines for sandbox.
/// On macOS: `~/Library/Application Support/com.memosa.app/`
/// This replaces the old `~/.memosa/` path which is not sandbox-compliant.
pub fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_default()
                .join("Library")
                .join("Application Support")
        })
        .join("com.memosa.app")
}
