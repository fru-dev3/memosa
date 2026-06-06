/// Resolve the full path to the ffmpeg binary.
///
/// macOS GUI apps launched from the Dock or Finder do not inherit the user's
/// shell PATH, so Homebrew-installed binaries (e.g. /opt/homebrew/bin/ffmpeg)
/// are invisible to plain `Command::new("ffmpeg")`.
pub fn ffmpeg_binary() -> std::path::PathBuf {
    let candidates = [
        "/opt/homebrew/bin/ffmpeg",  // Apple Silicon Homebrew
        "/usr/local/bin/ffmpeg",     // Intel Mac Homebrew
        "/opt/local/bin/ffmpeg",     // MacPorts
        "/usr/bin/ffmpeg",
    ];
    for path in &candidates {
        if std::path::Path::new(path).exists() {
            return std::path::PathBuf::from(path);
        }
    }
    // Fallback: let the OS resolve it (works when launched from terminal)
    std::path::PathBuf::from("ffmpeg")
}
