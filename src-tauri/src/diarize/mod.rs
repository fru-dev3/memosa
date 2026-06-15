//! Speaker diarization: the engine-agnostic foundation.
//!
//! Stores who-said-what as `SpeakerSegment`s (in the `speaker_segments` table)
//! and defines the [`Diarizer`] interface that any backend implements.
//!
//! Current backend: the existing AI speaker-labeling. **Planned upgrade:** a true
//! acoustic diarizer (sherpa-onnx — cross-platform, so it lands together with the
//! Windows work — running pyannote-style segmentation + speaker-embedding
//! clustering on-device). The storage, interface, and surfacing here are
//! engine-independent so swapping in the acoustic backend is localized.

use crate::storage::Database;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SpeakerSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub speaker: String,
    pub text: String,
}

/// A diarizer assigns speakers to time-stamped transcript pieces.
/// `pieces` are `(start_ms, end_ms, text)` from transcription.
pub trait Diarizer {
    fn label(&self, pieces: &[(i64, i64, String)]) -> Result<Vec<SpeakerSegment>, String>;
}

/// Merge consecutive segments by the same speaker into one — cleaner to store,
/// read, and display. Pure + deterministic.
pub fn merge_adjacent(segs: Vec<SpeakerSegment>) -> Vec<SpeakerSegment> {
    let mut out: Vec<SpeakerSegment> = Vec::new();
    for s in segs {
        if let Some(last) = out.last_mut() {
            if last.speaker == s.speaker {
                last.end_ms = s.end_ms;
                if !s.text.trim().is_empty() {
                    last.text.push(' ');
                    last.text.push_str(s.text.trim());
                }
                continue;
            }
        }
        out.push(s);
    }
    out
}

/// Return stored speaker segments for a meeting (empty if not diarized yet).
#[tauri::command]
pub async fn get_speaker_segments(
    meeting_id: String,
    db: tauri::State<'_, Database>,
) -> Result<Vec<SpeakerSegment>, String> {
    db.get_speaker_segments(&meeting_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(s: i64, e: i64, sp: &str, t: &str) -> SpeakerSegment {
        SpeakerSegment { start_ms: s, end_ms: e, speaker: sp.into(), text: t.into() }
    }

    #[test]
    fn merges_consecutive_same_speaker() {
        let input = vec![
            seg(0, 100, "A", "hello"),
            seg(100, 200, "A", "there"),
            seg(200, 300, "B", "hi"),
            seg(300, 400, "A", "bye"),
        ];
        let out = merge_adjacent(input);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].speaker, "A");
        assert_eq!(out[0].text, "hello there");
        assert_eq!(out[0].end_ms, 200);
        assert_eq!(out[2].text, "bye");
    }
}
