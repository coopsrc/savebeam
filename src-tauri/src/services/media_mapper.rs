//! Converts yt-dlp's evolving JSON schema into Savebeam's stable domain model.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::domain::{
    error::{AppError, ErrorCode},
    media::{FormatOption, MediaInfo, SubtitleTrack},
};

pub fn map_media_info(raw: &Value, requested_url: &str) -> Result<MediaInfo, AppError> {
    let id = nonempty_string(raw.get("id")).ok_or_else(|| invalid_metadata("缺少媒体标识"))?;
    let title =
        nonempty_string(raw.get("title")).ok_or_else(|| invalid_metadata("缺少媒体标题"))?;
    let webpage_url = nonempty_string(raw.get("webpage_url"))
        .or_else(|| nonempty_string(raw.get("original_url")))
        .unwrap_or_else(|| requested_url.to_owned());

    Ok(MediaInfo {
        id,
        title,
        webpage_url,
        thumbnail_url: nonempty_string(raw.get("thumbnail")),
        duration_seconds: positive_number(raw.get("duration")),
        uploader: nonempty_string(raw.get("uploader"))
            .or_else(|| nonempty_string(raw.get("channel"))),
        formats: map_formats(raw.get("formats")),
        subtitles: map_subtitles(raw.get("subtitles"), false)
            .into_iter()
            .chain(map_subtitles(raw.get("automatic_captions"), true))
            .collect(),
    })
}

fn map_formats(value: Option<&Value>) -> Vec<FormatOption> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|format| {
            let format_id = nonempty_string(format.get("format_id"))?;
            let extension = nonempty_string(format.get("ext"))?;
            let width = positive_integer(format.get("width"));
            let height = positive_integer(format.get("height"));
            let resolution = nonempty_string(format.get("resolution")).or_else(|| {
                height.map(|height| match width {
                    Some(width) => format!("{width}x{height}"),
                    None => format!("{height}p"),
                })
            });

            Some(FormatOption {
                format_id,
                extension,
                resolution,
                fps: positive_number(format.get("fps")),
                video_codec: codec(format.get("vcodec")),
                audio_codec: codec(format.get("acodec")),
                file_size_bytes: positive_integer(format.get("filesize")),
                approximate_file_size_bytes: positive_integer(format.get("filesize_approx")),
            })
        })
        .collect()
}

fn map_subtitles(value: Option<&Value>, automatic: bool) -> Vec<SubtitleTrack> {
    let mut seen = BTreeSet::new();
    let mut tracks = Vec::new();
    let Some(languages) = value.and_then(Value::as_object) else {
        return tracks;
    };

    for (language, variants) in languages {
        if language.is_empty() {
            continue;
        }
        for variant in variants.as_array().into_iter().flatten() {
            let extension = nonempty_string(variant.get("ext"));
            let name = nonempty_string(variant.get("name"));
            let key = (language.to_owned(), extension.clone(), name.clone());
            if seen.insert(key) {
                tracks.push(SubtitleTrack {
                    language: language.to_owned(),
                    name,
                    extension,
                    automatic,
                });
            }
        }
    }
    tracks
}

fn codec(value: Option<&Value>) -> Option<String> {
    nonempty_string(value).filter(|value| value != "none")
}

fn nonempty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn positive_number(value: Option<&Value>) -> Option<f64> {
    let number = value?.as_f64()?;
    (number.is_finite() && number > 0.0).then_some(number)
}

fn positive_integer(value: Option<&Value>) -> Option<u64> {
    let number = value?.as_u64()?;
    (number > 0).then_some(number)
}

fn invalid_metadata(reason: &str) -> AppError {
    AppError::new(
        ErrorCode::Unknown,
        "yt-dlp 返回的媒体信息不完整，无法展示。",
        true,
    )
    .with_diagnostic(reason)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::domain::error::ErrorCode;

    use super::map_media_info;

    #[test]
    fn maps_media_formats_and_subtitle_sources_to_stable_fields() {
        let raw = json!({
            "id": "video-1",
            "title": "  A title  ",
            "thumbnail": "https://img.example/thumb.jpg",
            "duration": 42.5,
            "channel": "Example channel",
            "formats": [
                { "format_id": "137", "ext": "mp4", "width": 1920, "height": 1080,
                  "fps": 30, "vcodec": "avc1", "acodec": "none", "filesize_approx": 2000 },
                { "format_id": "bad" },
                { "format_id": "audio", "ext": "m4a", "vcodec": "none", "acodec": "mp4a" }
            ],
            "subtitles": { "en": [{ "ext": "vtt", "name": "English" }] },
            "automatic_captions": { "zh-Hans": [{ "ext": "json3" }] }
        });

        let media = map_media_info(&raw, "https://example.com/requested")
            .expect("valid yt-dlp JSON should map");

        assert_eq!(media.title, "A title");
        assert_eq!(media.webpage_url, "https://example.com/requested");
        assert_eq!(media.uploader.as_deref(), Some("Example channel"));
        assert_eq!(media.formats.len(), 2);
        assert_eq!(media.formats[0].resolution.as_deref(), Some("1920x1080"));
        assert_eq!(media.formats[0].video_codec.as_deref(), Some("avc1"));
        assert_eq!(media.formats[0].audio_codec, None);
        assert_eq!(media.formats[0].approximate_file_size_bytes, Some(2000));
        assert_eq!(media.subtitles.len(), 2);
        assert!(!media.subtitles[0].automatic);
        assert!(media.subtitles[1].automatic);
    }

    #[test]
    fn prefers_canonical_url_and_channel_uploader_fallbacks() {
        let raw = json!({"id":"id", "title":"title", "webpage_url":"https://canonical"});
        let media = map_media_info(&raw, "https://requested").expect("minimal data should map");
        assert_eq!(media.webpage_url, "https://canonical");
        assert_eq!(media.formats.len(), 0);
        assert_eq!(media.duration_seconds, None);
    }

    #[test]
    fn rejects_payload_without_required_identity_fields() {
        let error = map_media_info(&json!({"title":"title"}), "https://example.com")
            .expect_err("id should be required");
        assert_eq!(error.code, ErrorCode::Unknown);
        assert!(error.diagnostic.is_some());
    }
}
