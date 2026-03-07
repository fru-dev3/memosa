fn main() {
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

        // Frameworks used by macos_helpers.m
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=AudioToolbox");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
}
