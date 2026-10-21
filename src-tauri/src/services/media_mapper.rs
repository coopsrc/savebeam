//! Converts yt-dlp's evolving JSON schema into Savebeam's stable domain model.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::domain::{
    error::{AppError, ErrorCode},
    media::{FormatOption, MediaInfo, PlaylistInfo, SubtitleTrack},
};

use crate::domain::download::MAX_PLAYLIST_ITEMS;

pub fn map_media_info(raw: &Value, requested_url: &str) -> Result<MediaInfo, AppError> {
    if raw.get("_type").and_then(Value::as_str) == Some("playlist") {
        return map_playlist_info(raw, requested_url);
    }
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
        thumbnail_url: thumbnail_url(raw),
        thumbnail_data_url: None,
        duration_seconds: positive_number(raw.get("duration")),
        uploader: nonempty_string(raw.get("uploader"))
            .or_else(|| nonempty_string(raw.get("channel"))),
        formats: map_formats(raw.get("formats")),
        subtitles: map_subtitles(raw.get("subtitles"), false)
            .into_iter()
            .chain(map_subtitles(raw.get("automatic_captions"), true))
            .collect(),
        playlist: None,
    })
}

fn map_playlist_info(raw: &Value, requested_url: &str) -> Result<MediaInfo, AppError> {
    let entries = raw
        .get("entries")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_metadata("播放列表缺少条目列表"))?;
    if entries.is_empty() {
        return Err(invalid_metadata("播放列表没有可下载条目"));
    }

    let observed_count = entries.len() as u64;
    let total_count = raw
        .get("playlist_count")
        .and_then(Value::as_u64)
        .filter(|count| *count > 0)
        .map(|count| count.max(observed_count))
        .or((observed_count <= u64::from(MAX_PLAYLIST_ITEMS)).then_some(observed_count));
    let truncated = total_count
        .map(|count| count > u64::from(MAX_PLAYLIST_ITEMS))
        .unwrap_or(observed_count > u64::from(MAX_PLAYLIST_ITEMS));
    let download_count = total_count
        .unwrap_or(observed_count)
        .min(u64::from(MAX_PLAYLIST_ITEMS)) as u8;

    Ok(MediaInfo {
        id: nonempty_string(raw.get("id")).unwrap_or_else(|| requested_url.to_owned()),
        title: nonempty_string(raw.get("title")).unwrap_or_else(|| "播放列表".into()),
        webpage_url: nonempty_string(raw.get("webpage_url"))
            .or_else(|| nonempty_string(raw.get("original_url")))
            .unwrap_or_else(|| requested_url.to_owned()),
        thumbnail_url: thumbnail_url(raw),
        thumbnail_data_url: None,
        duration_seconds: None,
        uploader: nonempty_string(raw.get("uploader"))
            .or_else(|| nonempty_string(raw.get("channel"))),
        formats: Vec::new(),
        subtitles: Vec::new(),
        playlist: Some(PlaylistInfo {
            download_count,
            total_count,
            truncated,
        }),
    })
}

fn thumbnail_url(raw: &Value) -> Option<String> {
    nonempty_string(raw.get("thumbnail")).or_else(|| {
        raw.get("thumbnails")?
            .as_array()?
            .iter()
            .rev()
            .find_map(|item| nonempty_string(item.get("url")))
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
                audio_bitrate_kbps: positive_number(format.get("abr")),
                language: nonempty_string(format.get("language")),
                format_note: nonempty_string(format.get("format_note")),
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
                { "format_id": "audio", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "abr": 192,
                  "language": "zh-Hans", "format_note": "original" }
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
        assert_eq!(media.formats[1].audio_bitrate_kbps, Some(192.0));
        assert_eq!(media.formats[1].language.as_deref(), Some("zh-Hans"));
        assert_eq!(media.formats[1].format_note.as_deref(), Some("original"));
        assert_eq!(media.subtitles.len(), 2);
        assert!(!media.subtitles[0].automatic);
        assert!(media.subtitles[1].automatic);
        assert!(media.playlist.is_none());
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

    #[test]
    fn maps_playlist_count_and_caps_downloadable_items() {
        let raw = json!({
            "_type": "playlist",
            "id": "playlist-1",
            "title": "Example list",
            "webpage_url": "https://example.com/list",
            "playlist_count": 73,
            "entries": (0..51).map(|index| json!({"id": index.to_string()})).collect::<Vec<_>>()
        });

        let result = map_media_info(&raw, "https://example.com/list").unwrap();
        let playlist = result.playlist.unwrap();
        assert_eq!(playlist.download_count, 50);
        assert_eq!(playlist.total_count, Some(73));
        assert!(playlist.truncated);
        assert!(result.formats.is_empty());
    }

    #[test]
    fn maps_small_playlist_as_exact_and_rejects_empty_playlist() {
        let raw = json!({
            "_type": "playlist",
            "id": "playlist-1",
            "title": "Small list",
            "entries": [{"id": "one"}, {"id": "two"}]
        });
        let result = map_media_info(&raw, "https://example.com/list").unwrap();
        let playlist = result.playlist.unwrap();
        assert_eq!(playlist.download_count, 2);
        assert_eq!(playlist.total_count, Some(2));
        assert!(!playlist.truncated);

        let empty = json!({"_type": "playlist", "entries": []});
        assert!(map_media_info(&empty, "https://example.com/list").is_err());
    }
}
