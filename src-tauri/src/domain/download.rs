//! Download task contracts shared by the queue, process adapter, and IPC.

use serde::{Deserialize, Serialize};

pub const MAX_PLAYLIST_ITEMS: u8 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadGroupKind {
    Collection,
    Multipart,
}

/// Display-only collection identity. Never used as an execution selector or filesystem path.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadGroup {
    pub key: String,
    pub title: String,
    pub source_url: String,
    pub kind: DownloadGroupKind,
    pub item_index: Option<u32>,
    pub part_index: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadGroupHint {
    pub title: String,
    pub kind: DownloadGroupKind,
}

/// Immutable naming and identity context for a Bilibili multipart entry inside a collection.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistPartContext {
    pub source_url: String,
    pub collection_id: String,
    pub collection_title: String,
    pub parent_id: String,
    pub parent_index: u32,
    pub part_index: u32,
    pub part_count: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CookieBrowser {
    Brave,
    Chrome,
    Chromium,
    Edge,
    Firefox,
    Opera,
    Safari,
    Vivaldi,
    Whale,
}

impl CookieBrowser {
    pub fn yt_dlp_name(self) -> &'static str {
        match self {
            Self::Brave => "brave",
            Self::Chrome => "chrome",
            Self::Chromium => "chromium",
            Self::Edge => "edge",
            Self::Firefox => "firefox",
            Self::Opera => "opera",
            Self::Safari => "safari",
            Self::Vivaldi => "vivaldi",
            Self::Whale => "whale",
        }
    }

    pub fn from_yt_dlp_name(value: &str) -> Option<Self> {
        match value {
            "brave" => Some(Self::Brave),
            "chrome" => Some(Self::Chrome),
            "chromium" => Some(Self::Chromium),
            "edge" => Some(Self::Edge),
            "firefox" => Some(Self::Firefox),
            "opera" => Some(Self::Opera),
            "safari" => Some(Self::Safari),
            "vivaldi" => Some(Self::Vivaldi),
            "whale" => Some(Self::Whale),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    #[serde(default)]
    pub format_details: Option<super::task_format::TaskFormat>,
    #[serde(default)]
    pub batch_id: Option<String>,
    /// A bounded raster preview cached separately from task snapshots and execution arguments.
    #[serde(default)]
    pub thumbnail_data_url: Option<String>,
    #[serde(default)]
    pub group: Option<DownloadGroup>,
    #[serde(default)]
    pub playlist_part: Option<PlaylistPartContext>,
    pub title: String,
    pub url: String,
    pub format_id: String,
    #[serde(default)]
    pub merge_container: Option<MergeContainer>,
    pub output_directory: String,
    #[serde(default)]
    pub subtitle_languages: Vec<String>,
    #[serde(default)]
    pub conflict_strategy: DownloadConflictStrategy,
    #[serde(default)]
    pub playlist_item_count: Option<u8>,
    #[serde(default)]
    pub playlist_items: Option<Vec<u32>>,
    /// Internal ID guard for a single subscription item; stripped from ordinary IPC tasks.
    #[serde(default)]
    pub expected_media_id: Option<String>,
    #[serde(default)]
    pub audio_only: bool,
    #[serde(default)]
    pub write_automatic_subtitles: bool,
    #[serde(default)]
    pub write_thumbnail: bool,
    #[serde(default)]
    pub write_info_json: bool,
    #[serde(default)]
    pub embed_metadata: bool,
    #[serde(default)]
    pub keep_intermediate_files: bool,
    /// None is reserved for legacy tasks that inherited the global network mode.
    #[serde(default)]
    pub use_proxy: Option<bool>,
    #[serde(default)]
    pub quality_policy: Option<super::playlist_quality::PlaylistQuality>,
    /// Internal lineage for an explicitly requested, non-overwriting version download.
    #[serde(default)]
    pub version_parent_task_id: Option<String>,
    #[serde(default)]
    pub cookies_file_path: Option<String>,
    #[serde(default)]
    pub cookies_browser: Option<CookieBrowser>,
    #[serde(default)]
    pub cookie_access_confirmed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeContainer {
    Mp4,
    Webm,
    Mkv,
}

impl MergeContainer {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
            Self::Mkv => "mkv",
        }
    }
}

/// App-wide authenticated extraction settings. Consent is stored separately
/// from download tasks and applies to both metadata inspection and downloads.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CookiePreferences {
    pub cookies_file_path: Option<String>,
    pub cookies_browser: Option<CookieBrowser>,
    pub access_confirmed: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadConflictStrategy {
    #[default]
    Skip,
    Overwrite,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPreferences {
    pub output_directory: String,
    pub max_concurrent: usize,
    pub conflict_strategy: DownloadConflictStrategy,
}

impl Default for DownloadPreferences {
    fn default() -> Self {
        Self {
            output_directory: String::new(),
            max_concurrent: 1,
            conflict_strategy: DownloadConflictStrategy::Skip,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DownloadTaskStatus {
    Queued,
    Preparing,
    Downloading,
    PostProcessing,
    Completed,
    Failed,
    Cancelling,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_details: Option<super::task_format::TaskFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub batch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<DownloadGroup>,
    pub id: String,
    pub url: String,
    pub title: String,
    pub format_id: String,
    pub status: DownloadTaskStatus,
    pub created_at_unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub task_id: String,
    pub status: DownloadTaskStatus,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub post_processing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub task_id: String,
    pub title: String,
    pub output_paths: Vec<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHistoryRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<DownloadGroup>,
    pub task_id: String,
    pub title: String,
    pub output_paths: Vec<String>,
    pub total_bytes: u64,
    pub completed_at_unix_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::{DownloadOptions, DownloadProgress, DownloadTaskStatus};

    #[test]
    fn deserializes_download_options_from_camel_case_ipc_fields() {
        let options: DownloadOptions = serde_json::from_value(serde_json::json!({
            "title": "Example",
            "url": "https://example.com/video",
            "formatId": "bestvideo+bestaudio",
            "outputDirectory": "/tmp/savebeam",
            "subtitleLanguages": ["en"]
        }))
        .expect("options should deserialize");

        assert_eq!(options.format_id, "bestvideo+bestaudio");
        assert_eq!(options.title, "Example");
        assert_eq!(options.subtitle_languages, ["en"]);
        assert_eq!(options.playlist_item_count, None);
        assert_eq!(options.playlist_items, None);
        assert_eq!(options.merge_container, None);
        assert_eq!(options.use_proxy, None);
        assert!(!options.audio_only);
        assert!(!options.write_automatic_subtitles);
        assert!(!options.write_thumbnail);
        assert!(!options.write_info_json);
        assert!(!options.embed_metadata);
        assert!(!options.keep_intermediate_files);
        let mut retained = options.clone();
        retained.keep_intermediate_files = true;
        assert_eq!(
            serde_json::to_value(retained).unwrap()["keepIntermediateFiles"],
            true
        );
        assert_eq!(options.cookies_file_path, None);
        assert_eq!(options.cookies_browser, None);
        assert!(!options.cookie_access_confirmed);
    }

    #[test]
    fn serializes_progress_and_status_using_stable_contract_names() {
        let progress = DownloadProgress {
            task_id: "task-1".into(),
            status: DownloadTaskStatus::PostProcessing,
            downloaded_bytes: Some(1024),
            total_bytes: Some(2048),
            speed_bytes_per_second: Some(512.0),
            eta_seconds: Some(2.0),
            post_processing: true,
        };
        let value = serde_json::to_value(progress).expect("progress should serialize");

        assert_eq!(value["taskId"], "task-1");
        assert_eq!(value["status"], "post_processing");
        assert_eq!(value["speedBytesPerSecond"], 512.0);
        assert_eq!(value["postProcessing"], true);
    }
}
