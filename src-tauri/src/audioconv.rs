//! Portable audio decode → 16 kHz mono f32 PCM for whisper.cpp.
//!
//! macOS uses the AVFoundation path in `macos.rs`; Windows/Linux use this
//! symphonia-based decoder (symphonia is already a dependency and is pure Rust,
//! so it cross-compiles). Linear resampling is plenty for speech → whisper.

use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const TARGET_HZ: u32 = 16_000;

/// Decode any supported audio file to 16 kHz mono f32 samples.
pub fn decode_to_whisper(path: &Path) -> Result<Vec<f32>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open audio: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("probe audio: {e}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "no audio track".to_string())?;
    let track_id = track.id;
    let src_rate = track.codec_params.sample_rate.unwrap_or(TARGET_HZ);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("make decoder: {e}"))?;

    let mut mono: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break, // end of stream
        };
        if packet.track_id() != track_id {
            continue;
        }
        if let Ok(decoded) = decoder.decode(&packet) {
            let spec = *decoded.spec();
            let ch = spec.channels.count().max(1);
            let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
            buf.copy_interleaved_ref(decoded);
            for frame in buf.samples().chunks(ch) {
                let sum: f32 = frame.iter().sum();
                mono.push(sum / ch as f32);
            }
        }
    }

    if mono.is_empty() {
        return Err("decoded no audio samples".into());
    }
    Ok(resample_linear(&mono, src_rate, TARGET_HZ))
}

/// Linear resample mono f32 from `from` Hz to `to` Hz.
pub fn resample_linear(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = to as f64 / from as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    let last = input.len() - 1;
    for i in 0..out_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input[idx.min(last)];
        let b = input[(idx + 1).min(last)];
        out.push(a + (b - a) * frac);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_changes_length_proportionally() {
        let input = vec![0.0f32; 32_000]; // 2s @ 16k stand-in
        let down = resample_linear(&input, 32_000, 16_000);
        assert_eq!(down.len(), 16_000);
        let same = resample_linear(&input, 16_000, 16_000);
        assert_eq!(same.len(), input.len());
    }

    #[test]
    fn resample_preserves_endpoints() {
        let input = vec![1.0, 2.0, 3.0, 4.0];
        let out = resample_linear(&input, 4, 8);
        assert!((out[0] - 1.0).abs() < 1e-6);
        assert!(out.len() == 8);
    }
}
