/// macOS microphone permission — in-process via Objective-C.
///
/// `memosa_request_microphone_access()` is compiled from mic_permission.m via
/// build.rs using the `cc` crate. Because it runs inside the memosa process
/// (which is signed with `com.apple.security.device.audio-input`), macOS shows
/// the TCC permission dialog for Memosa — not for a subprocess.

#[cfg(target_os = "macos")]
unsafe extern "C" {
    /// Returns 0 if microphone access is authorized, 1 if denied/restricted.
    /// If permission is notDetermined, blocks until the user responds to the
    /// macOS permission dialog.
    fn memosa_request_microphone_access() -> i32;
}

pub fn ensure_microphone_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let result = unsafe { memosa_request_microphone_access() };
        if result != 0 {
            return Err(
                "Microphone access was denied. Open System Settings → Privacy & Security → \
                 Microphone and enable Memosa."
                    .to_string(),
            );
        }
    }
    Ok(())
}
