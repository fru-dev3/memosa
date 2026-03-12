/// Soft-clip a sample to prevent hard clipping.
/// Below ±0.9 the signal passes through unchanged; above that a tanh knee
/// smoothly compresses the signal into the ±1.0 range.
#[inline]
fn soft_clip(sample: f32) -> f32 {
    let abs = sample.abs();
    if abs <= 0.9 {
        sample
    } else {
        sample.signum() * (0.9 + 0.1 * ((abs - 0.9) / 0.1).tanh())
    }
}

/// Mix two PCM f32 streams with adaptive gain.
///
/// - If system audio is empty (not available), returns the mic stream as-is.
/// - If system audio is effectively silent (RMS < −40 dB), the mic signal
///   passes through at unity gain so quiet mic recordings are not halved.
/// - If both streams are active, they are summed at full volume and soft-clipped
///   to avoid harsh distortion.
/// - If lengths differ, the shorter stream is zero-padded conceptually (the
///   tail of the longer stream is kept).
pub fn mix_streams(mic: &[f32], system: &[f32]) -> Vec<f32> {
    if system.is_empty() {
        return mic.to_vec();
    }

    // Detect whether system audio is effectively silent (~-40 dB).
    let sys_rms = if system.is_empty() {
        0.0
    } else {
        system.iter().map(|s| s * s).sum::<f32>() / system.len() as f32
    };
    let sys_is_silent = sys_rms < 0.0001;

    let len = mic.len().max(system.len());
    let mut out = Vec::with_capacity(len);

    for i in 0..len {
        let m = mic.get(i).copied().unwrap_or(0.0);
        let s = system.get(i).copied().unwrap_or(0.0);
        let mixed = if sys_is_silent {
            m // unity gain for mic-only
        } else {
            soft_clip(m + s) // sum with soft limiting
        };
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
    fn mix_unity_gain_when_system_silent() {
        // System audio is all zeros → mic should pass through at unity gain
        let mic = vec![0.5_f32, -0.3, 0.8];
        let sys = vec![0.0_f32, 0.0, 0.0];
        let out = mix_streams(&mic, &sys);
        assert!((out[0] - 0.5).abs() < 1e-6);
        assert!((out[1] - (-0.3)).abs() < 1e-6);
        assert!((out[2] - 0.8).abs() < 1e-6);
    }

    #[test]
    fn mix_sums_with_soft_clip_when_both_active() {
        // Both streams active: values below 0.9 pass through as a simple sum
        let mic = vec![0.3_f32, 0.2];
        let sys = vec![0.4_f32, 0.3];
        let out = mix_streams(&mic, &sys);
        assert!((out[0] - 0.7).abs() < 1e-6);
        assert!((out[1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn mix_soft_clips_loud_sum() {
        // When mic + system > 0.9, soft clipping should compress but stay < 1.0
        let mic = vec![0.8_f32];
        let sys = vec![0.8_f32];
        let out = mix_streams(&mic, &sys);
        // Raw sum would be 1.6; soft_clip should put it below 1.0
        assert!(out[0] > 0.9);
        assert!(out[0] < 1.0);
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
