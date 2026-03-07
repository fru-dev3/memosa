/// Mix two PCM f32 streams by averaging them sample-by-sample.
/// If system audio is empty (not available), returns the mic stream as-is.
/// If lengths differ, the shorter stream is zero-padded conceptually (only
/// the overlapping region is averaged; the tail of the longer stream is kept).
pub fn mix_streams(mic: &[f32], system: &[f32]) -> Vec<f32> {
    if system.is_empty() {
        return mic.to_vec();
    }

    let len = mic.len().max(system.len());
    let mut out = Vec::with_capacity(len);

    for i in 0..len {
        let m = mic.get(i).copied().unwrap_or(0.0);
        let s = system.get(i).copied().unwrap_or(0.0);
        // Average the two streams; clamp to [-1, 1] to avoid clipping artefacts.
        let mixed = ((m + s) * 0.5).clamp(-1.0, 1.0);
        out.push(mixed);
    }

    out
}

/// Compute the root-mean-square amplitude of a PCM buffer.
/// Returns a value in [0.0, 1.0] suitable for waveform visualisation.
pub fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mix_mic_only_when_system_empty() {
        let mic = vec![0.5_f32, -0.5, 0.25];
        let out = mix_streams(&mic, &[]);
        assert_eq!(out, mic);
    }

    #[test]
    fn mix_averages_streams() {
        let mic = vec![1.0_f32, 0.0];
        let sys = vec![0.0_f32, 1.0];
        let out = mix_streams(&mic, &sys);
        assert!((out[0] - 0.5).abs() < 1e-6);
        assert!((out[1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn rms_silence_is_zero() {
        assert_eq!(compute_rms(&[0.0, 0.0, 0.0]), 0.0);
    }

    #[test]
    fn rms_full_scale_sine_approx() {
        // For a full-scale square wave the RMS is 1.0
        let sq: Vec<f32> = (0..1000)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        let rms = compute_rms(&sq);
        assert!((rms - 1.0).abs() < 1e-4);
    }
}
