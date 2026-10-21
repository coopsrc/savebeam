//! Download task contracts shared by the queue, process adapter, and IPC.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub title: String,
    pub url: String,
    pub format_id: String,
    pub output_directory: String,
    #[serde(default)]
    pub subtitle_languages: Vec<String>,
    #[serde(default)]
    pub conflict_strategy: DownloadConflictStrategy,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
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
