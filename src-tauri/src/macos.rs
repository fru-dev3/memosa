// macos.rs
// Safe Rust wrappers for the ObjC helpers in macos_helpers.m.
// These replace every std::process::Command call that is forbidden in the MAS sandbox.

#![cfg(target_os = "macos")]

use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use std::path::Path;

unsafe extern "C" {
    fn memosa_get_frontmost_app() -> *mut c_char;
    fn memosa_free_string(s: *mut c_char);
    fn memosa_play_system_ping();
    fn memosa_reveal_in_finder(path: *const c_char);
    fn memosa_open_url(url: *const c_char);
    fn memosa_encode_wav_to_m4a(
        input: *const c_char,
        output: *const c_char,
        error_out: *mut c_char,
        error_len: c_int,
    ) -> c_int;
    fn memosa_get_audio_peak_db(
        path: *const c_char,
        peak_out: *mut f32,
        error_out: *mut c_char,
        error_len: c_int,
    ) -> c_int;
    fn memosa_convert_to_whisper_format(
        path: *const c_char,
        samples_out: *mut *mut f32,
        frames_out: *mut i64,
        error_out: *mut c_char,
        error_len: c_int,
    ) -> c_int;
    fn memosa_free_buffer(buf: *mut std::ffi::c_void);
    fn memosa_create_security_bookmark(
        path: *const c_char,
        data_out: *mut *mut u8,
        len_out: *mut c_int,
        error_out: *mut c_char,
        error_len: c_int,
    ) -> c_int;
    fn memosa_resolve_security_bookmark(
        data: *const u8,
        data_len: c_int,
        path_out: *mut c_char,
        path_out_len: c_int,
        stale_out: *mut c_int,
        error_out: *mut c_char,
        error_len: c_int,
    ) -> c_int;
}

/// Return the name of the frontmost application, or None if detection fails.
/// Never returns "Memosa" — callers should treat None as "no interesting app".
pub fn get_frontmost_app() -> Option<String> {
    let ptr = unsafe { memosa_get_frontmost_app() };
    if ptr.is_null() {
        return None;
    }
    let name = unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    unsafe { memosa_free_string(ptr) };
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Play the system "Ping" sound (used as an audio test tone).
pub fn play_system_ping() {
    unsafe { memosa_play_system_ping() }
}

/// Reveal a file/folder in Finder (sandbox-safe replacement for `open <path>`).
pub fn reveal_in_finder(path: &Path) -> Result<(), String> {
    let c_path = CString::new(path.to_str().ok_or("Invalid path encoding")?)
        .map_err(|e| format!("CString error: {e}"))?;
    unsafe { memosa_reveal_in_finder(c_path.as_ptr()) };
    Ok(())
}

/// Open a URL in the user's default browser (sandbox-safe replacement for `open <url>`).
pub fn open_url(url: &str) -> Result<(), String> {
    let c_url = CString::new(url).map_err(|e| format!("CString error: {e}"))?;
    unsafe { memosa_open_url(c_url.as_ptr()) };
    Ok(())
}

/// Encode a WAV file to M4A (AAC mono 128 kbps) using CoreAudio's ExtAudioFile.
/// Replaces the `ffmpeg -c:a aac` subprocess.
pub fn encode_wav_to_m4a(wav: &Path, m4a: &Path) -> Result<(), String> {
    let c_in = CString::new(wav.to_str().ok_or("Invalid WAV path")?)
        .map_err(|e| format!("CString WAV: {e}"))?;
    let c_out = CString::new(m4a.to_str().ok_or("Invalid M4A path")?)
        .map_err(|e| format!("CString M4A: {e}"))?;

    let mut err_buf = [0u8; 512];
    let ret = unsafe {
        memosa_encode_wav_to_m4a(
            c_in.as_ptr(),
            c_out.as_ptr(),
            err_buf.as_mut_ptr() as *mut c_char,
            512,
        )
    };
    if ret != 0 {
        let msg = std::str::from_utf8(&err_buf)
            .unwrap_or("unknown error")
            .trim_end_matches('\0')
            .to_string();
        Err(msg)
    } else {
        Ok(())
    }
}

/// Convert an audio file to 16 kHz mono f32 PCM samples for whisper.cpp.
/// Replaces the `ffmpeg -ar 16000 -ac 1 -f f32le` subprocess.
pub fn convert_to_whisper_format(path: &Path) -> Result<Vec<f32>, String> {
    let c_path = CString::new(path.to_str().ok_or("Invalid audio path")?)
        .map_err(|e| format!("CString error: {e}"))?;

    let mut samples_ptr: *mut f32 = std::ptr::null_mut();
    let mut frames: i64 = 0;
    let mut err_buf = [0u8; 512];

    let ret = unsafe {
        memosa_convert_to_whisper_format(
            c_path.as_ptr(),
            &mut samples_ptr,
            &mut frames,
            err_buf.as_mut_ptr() as *mut c_char,
            512,
        )
    };

    if ret != 0 {
        let msg = std::str::from_utf8(&err_buf)
            .unwrap_or("unknown error")
            .trim_end_matches('\0')
            .to_string();
        return Err(msg);
    }

    if samples_ptr.is_null() || frames <= 0 {
        return Err("Audio conversion returned empty buffer".to_string());
    }

    // Copy into a Rust Vec, then free the ObjC-allocated buffer.
    let samples = unsafe { std::slice::from_raw_parts(samples_ptr, frames as usize) }.to_vec();
    unsafe { memosa_free_buffer(samples_ptr as *mut std::ffi::c_void) };

    Ok(samples)
}

/// Create an app-scoped security-scoped bookmark from a filesystem path.
/// Returns the raw bookmark bytes that can be persisted.
pub fn create_security_bookmark(path: &Path) -> Result<Vec<u8>, String> {
    let c_path = CString::new(path.to_str().ok_or("Invalid path encoding")?)
        .map_err(|e| format!("CString error: {e}"))?;
    let mut data_ptr: *mut u8 = std::ptr::null_mut();
    let mut data_len: c_int = 0;
    let mut err_buf = [0u8; 512];
    let ret = unsafe {
        memosa_create_security_bookmark(
            c_path.as_ptr(),
            &mut data_ptr,
            &mut data_len,
            err_buf.as_mut_ptr() as *mut c_char,
            512,
        )
    };
    if ret != 0 {
        let msg = std::str::from_utf8(&err_buf)
            .unwrap_or("unknown error")
            .trim_end_matches('\0')
            .to_string();
        return Err(msg);
    }
    if data_ptr.is_null() || data_len <= 0 {
        return Err("Bookmark creation returned empty data".to_string());
    }
    let bytes = unsafe { std::slice::from_raw_parts(data_ptr, data_len as usize) }.to_vec();
    unsafe { memosa_free_buffer(data_ptr as *mut std::ffi::c_void) };
    Ok(bytes)
}

/// Resolve a security-scoped bookmark, calling startAccessingSecurityScopedResource.
/// Returns (resolved_path, is_stale).
pub fn resolve_security_bookmark(data: &[u8]) -> Result<(String, bool), String> {
    let mut path_buf = [0u8; 2048];
    let mut stale: c_int = 0;
    let mut err_buf = [0u8; 512];
    let ret = unsafe {
        memosa_resolve_security_bookmark(
            data.as_ptr(),
            data.len() as c_int,
            path_buf.as_mut_ptr() as *mut c_char,
            2048,
            &mut stale,
            err_buf.as_mut_ptr() as *mut c_char,
            512,
        )
    };
    if ret != 0 {
        let msg = std::str::from_utf8(&err_buf)
            .unwrap_or("unknown error")
            .trim_end_matches('\0')
            .to_string();
        return Err(msg);
    }
    let path = std::str::from_utf8(&path_buf)
        .unwrap_or("")
        .trim_end_matches('\0')
        .to_string();
    Ok((path, stale != 0))
}

/// Read an audio file and return its absolute peak level in dBFS.
/// Returns None if the file cannot be read or analysed.
pub fn get_audio_peak_db(path: &Path) -> Option<f32> {
    let c_path = CString::new(path.to_str()?).ok()?;
    let mut peak: f32 = 0.0;
    let mut err_buf = [0u8; 256];
    let ret = unsafe {
        memosa_get_audio_peak_db(
            c_path.as_ptr(),
            &mut peak as *mut f32,
            err_buf.as_mut_ptr() as *mut c_char,
            256,
        )
    };
    if ret == 0 {
        Some(peak)
    } else {
        None
    }
}
