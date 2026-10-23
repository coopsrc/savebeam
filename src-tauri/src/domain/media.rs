//! Stable media metadata exposed to application services and the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaType {
    Single,
    Multipart,
    Collection,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaPreview {
    pub uploader: Option<String>,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub media_type: MediaType,
    pub id: String,
    pub title: String,
    pub webpage_url: String,
    pub thumbnail_url: Option<String>,
    pub thumbnail_data_url: Option<String>,
    pub duration_seconds: Option<f64>,
    pub uploader: Option<String>,
    pub formats: Vec<FormatOption>,
    pub subtitles: Vec<SubtitleTrack>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub playlist: Option<PlaylistInfo>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInfo {
    /// Number of selectable entries exposed among the first 50 source positions.
    pub download_count: u8,
    /// Exact upstream count, when yt-dlp reports one.
    pub total_count: Option<u64>,
    /// True when the playlist is known or observed to exceed the safe per-task limit.
    pub truncated: bool,
    pub id: Option<String>,
    pub title: String,
    pub entries: Vec<PlaylistEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub index: u32,
    pub id: Option<String>,
    pub title: String,
    pub available: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub format_id: String,
    pub extension: String,
    pub resolution: Option<String>,
    pub height: Option<u32>,
    pub video_bitrate_kbps: Option<f64>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_bitrate_kbps: Option<f64>,
    pub language: Option<String>,
    pub format_note: Option<String>,
    pub file_size_bytes: Option<u64>,
    pub approximate_file_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub language: String,
    pub name: Option<String>,
    pub extension: Option<String>,
    pub automatic: bool,
}

#[cfg(test)]
mod tests {
    use super::{FormatOption, MediaInfo, MediaType, SubtitleTrack};

    #[test]
    fn serializes_stable_media_shape_in_camel_case() {
        let media = MediaInfo {
            media_type: MediaType::Single,
            id: "abc".into(),
            title: "Example".into(),
            webpage_url: "https://example.com/watch/abc".into(),
            thumbnail_url: None,
            thumbnail_data_url: None,
            duration_seconds: Some(12.5),
            uploader: Some("Uploader".into()),
            formats: vec![FormatOption {
                format_id: "best".into(),
                extension: "mp4".into(),
                resolution: Some("1080p".into()),
                height: Some(1080),
                video_bitrate_kbps: None,
                fps: Some(30.0),
                video_codec: Some("avc1".into()),
                audio_codec: None,
                audio_bitrate_kbps: None,
                language: None,
                format_note: None,
                file_size_bytes: None,
                approximate_file_size_bytes: Some(1024),
            }],
            subtitles: vec![SubtitleTrack {
                language: "en".into(),
                name: Some("English".into()),
                extension: Some("vtt".into()),
                automatic: false,
            }],
            playlist: None,
        };

        let value = serde_json::to_value(media).expect("media should serialize");
        assert_eq!(value["webpageUrl"], "https://example.com/watch/abc");
        assert_eq!(value["mediaType"], "single");
        assert_eq!(value["formats"][0]["formatId"], "best");
        assert_eq!(value["formats"][0]["approximateFileSizeBytes"], 1024);
        assert_eq!(value["subtitles"][0]["automatic"], false);
        assert!(value["thumbnailUrl"].is_null());
    }
}
