//! Capture only the selected streams, without raw URLs, headers or complete source JSON.
use crate::domain::{download::MergeContainer, media::FormatOption, task_format::TaskFormat};

pub fn capture(
    formats: &[FormatOption],
    selector: &str,
    merge: Option<MergeContainer>,
    audio_only: bool,
) -> Option<TaskFormat> {
    let ids: Vec<_> = selector.split('+').collect();
    if ids.is_empty() || ids.len() > 2 {
        return None;
    }
    let selected: Option<Vec<_>> = ids
        .iter()
        .map(|id| {
            let mut matching = formats.iter().filter(|f| f.format_id == *id);
            let one = matching.next()?;
            matching.next().is_none().then_some(one)
        })
        .collect();
    let selected = selected?;
    let video = (!audio_only)
        .then(|| selected.iter().find(|f| f.video_codec.is_some()))
        .flatten();
    let audio = selected.iter().find(|f| f.audio_codec.is_some());
    let result = TaskFormat {
        output_extension: Some(if audio_only {
            "mp3".into()
        } else {
            merge.map_or_else(|| selected[0].extension.clone(), |m| m.extension().into())
        }),
        audio_only,
        resolution: video.and_then(|f| {
            f.resolution
                .clone()
                .or_else(|| f.height.map(|h| format!("{h}p")))
        }),
        fps: video.and_then(|f| positive(f.fps)),
        video_codec: video.and_then(|f| f.video_codec.clone()),
        video_bitrate_kbps: video.and_then(|f| positive(f.video_bitrate_kbps)),
        audio_codec: audio.and_then(|f| f.audio_codec.clone()),
        audio_bitrate_kbps: audio.and_then(|f| positive(f.audio_bitrate_kbps)),
        audio_extension: audio.map(|f| f.extension.clone()),
    };
    result.valid().then_some(result)
}

fn positive(value: Option<f64>) -> Option<f64> {
    value.filter(|n| n.is_finite() && *n > 0.0 && *n <= 1_000_000.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn captures_exact_streams_and_muxed_audio_without_guessing_site_ids() {
        let formats = crate::services::media_mapper::map_formats(
            Some(&json!([
                {"format_id":"100143", "ext":"mp4", "vcodec":"hvc1", "height":1080, "width":1920, "fps":29.97, "vbr":1266},
                {"format_id":"30280", "ext":"m4a", "acodec":"mp4a.40.2", "abr":128},
                {"format_id":"mux", "ext":"webm", "vcodec":"vp9", "acodec":"opus", "height":720, "abr":160}
            ])),
            None,
        );
        let snapshot = capture(&formats, "100143+30280", Some(MergeContainer::Mp4), false).unwrap();
        assert_eq!(snapshot.fps, Some(29.97));
        assert_eq!(snapshot.video_codec.as_deref(), Some("hvc1"));
        assert_eq!(snapshot.audio_bitrate_kbps, Some(128.0));
        assert_eq!(snapshot.output_extension.as_deref(), Some("mp4"));
        let mp3 = capture(&formats, "mux", None, true).unwrap();
        assert!(mp3.audio_only);
        assert!(mp3.video_codec.is_none());
        assert_eq!(mp3.audio_codec.as_deref(), Some("opus"));
        assert_eq!(mp3.output_extension.as_deref(), Some("mp3"));
        assert_eq!(
            capture(&formats, "mux", None, false)
                .unwrap()
                .audio_codec
                .as_deref(),
            Some("opus")
        );
        assert!(capture(&formats, "missing+30280", None, false).is_none());
        assert!(capture(&formats, "bestvideo+bestaudio/best", None, false).is_none());
        let mut bad = snapshot;
        bad.fps = Some(f64::NAN);
        assert!(!bad.valid());
        bad.fps = Some(30.0);
        bad.video_codec = Some("x".repeat(129));
        assert!(!bad.valid());
    }
}
