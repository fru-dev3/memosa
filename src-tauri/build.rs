fn main() {
    // The on-device AI helper (Apple's model, Swift only) ships beside the app's
    // binary as a Tauri sidecar, so it must exist before tauri_build checks it.
    #[cfg(target_os = "macos")]
    build_ai_helper();
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        // Compile the microphone permission helper (AVFoundation TCC dialog).
        cc::Build::new()
            .file("src/mic_permission.m")
            .flag("-fobjc-arc")
            .compile("mic_permission");

        // Compile the macOS sandbox helpers:
        //   - frontmost app detection (replaces osascript)
        //   - system ping sound (replaces afplay)
        //   - reveal in Finder / open URL (replaces `open` subprocess)
        //   - WAV→M4A encoding (replaces ffmpeg)
        //   - audio peak detection (replaces ffmpeg volumedetect)
        cc::Build::new()
            .file("src/macos_helpers.m")
            .flag("-fobjc-arc")
            .compile("macos_helpers");

        // EventKit calendar access (calendar auto-record).
        cc::Build::new()
            .file("src/calendar_helpers.m")
            .flag("-fobjc-arc")
            .compile("calendar_helpers");
        println!("cargo:rerun-if-changed=src/calendar_helpers.m");
        println!("cargo:rustc-link-lib=framework=EventKit");

        // Frameworks used by macos_helpers.m
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
}

/// Compile helpers/memosa-ai.swift to binaries/memosa-ai-<target triple>.
#[cfg(target_os = "macos")]
fn build_ai_helper() {
    println!("cargo:rerun-if-changed=helpers/memosa-ai.swift");
    let target = std::env::var("TARGET").unwrap_or_else(|_| "aarch64-apple-darwin".into());
    let arch = if target.starts_with("x86_64") { "x86_64" } else { "arm64" };
    std::fs::create_dir_all("binaries").expect("binaries dir");
    let out = format!("binaries/memosa-ai-{target}");
    let status = std::process::Command::new("xcrun")
        .args(["swiftc", "-O", "-parse-as-library", "-target", &format!("{arch}-apple-macos26.0")])
        .args(["helpers/memosa-ai.swift", "-o", &out])
        .status()
        .expect("xcrun swiftc");
    assert!(status.success(), "building the on-device AI helper failed");
}
