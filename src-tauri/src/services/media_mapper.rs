//! Converts yt-dlp's evolving JSON schema into Savebeam's stable domain model.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::domain::{
    error::{AppError, ErrorCode},
    media::{FormatOption, MediaInfo, MediaType, PlaylistEntry, PlaylistInfo, SubtitleTrack},
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
        media_type: MediaType::Single,
        id,
        title,
        webpage_url,
        thumbnail_url: thumbnail_url(raw),
        thumbnail_data_url: None,
        duration_seconds: positive_number(raw.get("duration")),
        uploader: nonempty_string(raw.get("uploader"))
            .or_else(|| nonempty_string(raw.get("channel"))),
        formats: map_formats(raw.get("formats"), positive_number(raw.get("duration"))),
        subtitles: map_subtitle_tracks(raw),
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
    let multipart = is_bilibili_multipart(raw, requested_url, entries);
    let total_count = raw
        .get("playlist_count")
        .and_then(Value::as_u64)
        .filter(|count| *count > 0)
        .map(|count| count.max(observed_count))
        .or((observed_count <= u64::from(MAX_PLAYLIST_ITEMS)).then_some(observed_count));
    let truncated = total_count
        .map(|count| count > u64::from(MAX_PLAYLIST_ITEMS))
        .unwrap_or(observed_count > u64::from(MAX_PLAYLIST_ITEMS));
    let mut seen_indices = BTreeSet::new();
    let selectable_entries: Vec<_> = entries
        .iter()
        .take(usize::from(MAX_PLAYLIST_ITEMS))
        .enumerate()
        .map(|(offset, entry)| {
            let index = entry
                .get("playlist_index")
                .and_then(Value::as_u64)
                .and_then(|index| u32::try_from(index).ok())
                .filter(|index| *index > 0)
                .unwrap_or(offset as u32 + 1);
            let id = if multipart {
                super::subscriptions::entry_id(entry)
            } else {
                nonempty_string(entry.get("id"))
            };
            let has_url = entry
                .get("url")
                .and_then(Value::as_str)
                .is_some_and(|url| url.starts_with("http://") || url.starts_with("https://"));
            PlaylistEntry {
                index,
                available: (id.is_some() || has_url)
                    && entry.get("_type").and_then(Value::as_str) != Some("playlist")
                    && index <= u32::from(MAX_PLAYLIST_ITEMS)
                    && seen_indices.insert(index),
                id,
                title: nonempty_string(entry.get("title")).unwrap_or_else(|| "标题待补全".into()),
            }
        })
        .collect();
    let download_count = selectable_entries
        .iter()
        .filter(|entry| entry.available)
        .count() as u8;

    Ok(MediaInfo {
        media_type: if multipart {
            MediaType::Multipart
        } else {
            MediaType::Collection
        },
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
            id: nonempty_string(raw.get("id")).or_else(|| nonempty_string(raw.get("series_id"))),
            title: nonempty_string(raw.get("title"))
                .or_else(|| nonempty_string(raw.get("series")))
                .or_else(|| nonempty_string(raw.get("playlist")))
                .unwrap_or_else(|| "未命名系列".into()),
            entries: selectable_entries,
        }),
    })
}

/// A playlist is not necessarily a collection. Require one verified BV parent and
/// explicit P relationships; never classify arbitrary short playlists by their length.
fn is_bilibili_multipart(raw: &Value, requested_url: &str, entries: &[Value]) -> bool {
    let Some(id) = raw["id"].as_str().filter(|id| {
        id.len() == 12 && id.starts_with("BV") && id.bytes().all(|b| b.is_ascii_alphanumeric())
    }) else {
        return false;
    };
    let Some(url) = raw["webpage_url"]
        .as_str()
        .or(Some(requested_url))
        .and_then(|u| reqwest::Url::parse(u).ok())
    else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || !matches!(
            url.host_str(),
            Some("bilibili.com" | "www.bilibili.com" | "m.bilibili.com")
        )
        || url.path().trim_end_matches('/') != format!("/video/{id}")
    {
        return false;
    }
    let mut seen = BTreeSet::new();
    !entries.is_empty()
        && entries.iter().enumerate().all(|(offset, entry)| {
            let index = entry["playlist_index"]
                .as_u64()
                .unwrap_or(offset as u64 + 1);
            seen.insert(index)
                && super::subscriptions::entry_id(entry).as_deref()
                    == Some(&format!("{id}_p{index}"))
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

pub(crate) fn map_formats(value: Option<&Value>, duration: Option<f64>) -> Vec<FormatOption> {
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
                height: height.and_then(|height| u32::try_from(height).ok()),
                video_bitrate_kbps: positive_number(format.get("vbr")).or_else(|| {
                    codec(format.get("vcodec"))?;
                    // A muxed stream's total bitrate must not be presented as video bitrate.
                    codec(format.get("acodec"))
                        .is_none()
                        .then(|| positive_number(format.get("tbr")))
                        .flatten()
                }),
                fps: positive_number(format.get("fps")),
                video_codec: codec(format.get("vcodec")),
                audio_codec: codec(format.get("acodec")),
                audio_bitrate_kbps: positive_number(format.get("abr")),
                language: nonempty_string(format.get("language")),
                format_note: nonempty_string(format.get("format_note")),
                file_size_bytes: positive_integer(format.get("filesize")),
                approximate_file_size_bytes: positive_integer(format.get("filesize_approx"))
                    .or_else(|| estimate_format_bytes(format, duration)),
            })
        })
        .collect()
}

pub(crate) fn estimate_format_bytes(format: &Value, duration: Option<f64>) -> Option<u64> {
    let duration = positive_number(format.get("duration")).or(duration)?;
    let bitrate = positive_number(format.get("tbr")).or_else(|| {
        match (codec(format.get("vcodec")), codec(format.get("acodec"))) {
            (Some(_), None) => positive_number(format.get("vbr")),
            (None, Some(_)) => positive_number(format.get("abr")),
            (Some(_), Some(_)) => {
                Some(positive_number(format.get("vbr"))? + positive_number(format.get("abr"))?)
            }
            (None, None) => None,
        }
    })?;
    let bytes = bitrate * 1000.0 * duration / 8.0;
    (bytes.is_finite() && bytes >= 1.0 && bytes < u64::MAX as f64).then_some(bytes.round() as u64)
}

pub fn map_subtitle_tracks(raw: &Value) -> Vec<SubtitleTrack> {
    map_subtitles(raw.get("subtitles"), false)
        .into_iter()
        .chain(map_subtitles(raw.get("automatic_captions"), true))
        .take(512)
        .collect()
}

fn map_subtitles(value: Option<&Value>, automatic: bool) -> Vec<SubtitleTrack> {
    let mut seen = BTreeSet::new();
    let mut tracks = Vec::new();
    let Some(languages) = value.and_then(Value::as_object) else {
        return tracks;
    };

    for (language, variants) in languages {
        if language.is_empty()
            || language.len() > 64
            || !language
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
        {
            continue;
        }
        for variant in variants.as_array().into_iter().flatten().take(32) {
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
            if tracks.len() >= 512 {
                return tracks;
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
    fn distinguishes_direct_multipart_video_from_collection_and_derives_exact_part_ids() {
        use crate::domain::media::MediaType;
        let raw = json!({"id":"BV1uVy7BCErV","_type":"playlist","title":"避震特别篇", "entries":[
            {"url":"https://www.bilibili.com/video/BV1uVy7BCErV?p=1"},
            {"url":"https://www.bilibili.com/video/BV1uVy7BCErV?p=2"}
        ]});
        let result = map_media_info(&raw, "https://www.bilibili.com/video/BV1uVy7BCErV").unwrap();
        assert_eq!(result.media_type, MediaType::Multipart);
        assert_eq!(
            result
                .playlist
                .unwrap()
                .entries
                .iter()
                .map(|e| e.id.as_deref())
                .collect::<Vec<_>>(),
            [Some("BV1uVy7BCErV_p1"), Some("BV1uVy7BCErV_p2")]
        );
        assert_eq!(
            map_media_info(
                &raw,
                "https://space.bilibili.com/123/channel/collectiondetail?sid=1"
            )
            .unwrap()
            .media_type,
            MediaType::Collection
        );
        assert_eq!(
            map_media_info(&raw, "https://bilibili.com.evil.invalid/video/BV1uVy7BCErV")
                .unwrap()
                .media_type,
            MediaType::Collection
        );
        let mut mixed = raw.clone();
        mixed["entries"][1]["url"] = json!("https://www.bilibili.com/video/BV19wee6BEeP?p=2");
        assert_eq!(
            map_media_info(&mixed, "https://www.bilibili.com/video/BV1uVy7BCErV")
                .unwrap()
                .media_type,
            MediaType::Collection
        );
        let generic = json!({"id":"list","_type":"playlist","title":"两条视频的合集","entries":[{"id":"a"},{"id":"b"}]});
        assert_eq!(
            map_media_info(&generic, "https://example.invalid/list")
                .unwrap()
                .media_type,
            MediaType::Collection
        );
        let single = json!({"id":"BV1uVy7BCErV_p2","title":"纯享版","formats":[]});
        assert_eq!(
            map_media_info(&single, "https://www.bilibili.com/video/BV1uVy7BCErV?p=2")
                .unwrap()
                .media_type,
            MediaType::Single
        );
    }

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
    fn estimates_missing_sizes_from_complete_bitrate_and_duration_metadata() {
        let raw = json!({
            "id": "sizes", "title": "Sizes", "duration": 10,
            "formats": [
                {"format_id":"video", "ext":"mp4", "vcodec":"avc1", "acodec":"none", "tbr":800},
                {"format_id":"audio", "ext":"m4a", "vcodec":"none", "acodec":"aac", "abr":128},
                {"format_id":"combined", "ext":"mp4", "vcodec":"avc1", "acodec":"aac", "vbr":800, "abr":128},
                {"format_id":"incomplete", "ext":"mp4", "vcodec":"avc1", "acodec":"aac", "vbr":800},
                {"format_id":"reported", "ext":"mp4", "vcodec":"avc1", "acodec":"none", "tbr":800, "filesize_approx":42},
                {"format_id":"short-audio", "ext":"m4a", "vcodec":"none", "acodec":"aac", "abr":128, "duration":5},
                {"format_id":"overflow", "ext":"mp4", "tbr":1e308}
            ]
        });
        let media = map_media_info(&raw, "https://example.com/video").unwrap();
        let estimates: Vec<_> = media
            .formats
            .iter()
            .map(|format| format.approximate_file_size_bytes)
            .collect();
        assert_eq!(
            estimates,
            [
                Some(1_000_000),
                Some(160_000),
                Some(1_160_000),
                None,
                Some(42),
                Some(80_000),
                None
            ]
        );
        let mut no_duration = raw;
        no_duration.as_object_mut().unwrap().remove("duration");
        let media = map_media_info(&no_duration, "https://example.com/video").unwrap();
        assert_eq!(media.formats[0].approximate_file_size_bytes, None);
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
    fn exposes_bounded_playlist_choices_without_renumbering_missing_entries() {
        let raw = json!({"_type":"playlist", "id":"list-123", "title":"课程", "entries":[
            {"id":"first", "title":"第一课", "playlist_index":1}, null,
            {"id":"third", "title":"第三课", "playlist_index":3},
            {"url":"https://example.com/unknown", "playlist_index":4},
            {"id":"duplicate", "playlist_index":3},
            {"id":"nested", "_type":"playlist"}
        ]});
        let media = map_media_info(&raw, "https://example.com/list").unwrap();
        let playlist = media.playlist.unwrap();
        assert_eq!(playlist.id.as_deref(), Some("list-123"));
        assert_eq!(playlist.title, "课程");
        assert_eq!(playlist.download_count, 3);
        assert_eq!(
            playlist
                .entries
                .iter()
                .map(|item| item.index)
                .collect::<Vec<_>>(),
            [1, 2, 3, 4, 3, 6]
        );
        assert!(!playlist.entries[1].available);
        assert!(!playlist.entries[4].available);
        assert!(!playlist.entries[5].available);
        assert_eq!(playlist.entries[2].id.as_deref(), Some("third"));
        assert!(playlist.entries[3].available);
        assert_eq!(playlist.entries[3].title, "标题待补全");
        let value = serde_json::to_value(playlist).unwrap();
        assert!(value["entries"][3].get("url").is_none());
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
