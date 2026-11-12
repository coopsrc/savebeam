//! A small, language-neutral selection snapshot. Never used to build download arguments.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskFormat {
    pub output_extension: Option<String>,
    pub audio_only: bool,
    pub resolution: Option<String>,
    pub fps: Option<f64>,
    pub video_codec: Option<String>,
    pub video_bitrate_kbps: Option<f64>,
    pub audio_codec: Option<String>,
    pub audio_bitrate_kbps: Option<f64>,
    pub audio_extension: Option<String>,
}

impl TaskFormat {
    pub fn valid(&self) -> bool {
        [
            &self.output_extension,
            &self.resolution,
            &self.video_codec,
            &self.audio_codec,
            &self.audio_extension,
        ]
        .into_iter()
        .all(|value| {
            value
                .as_ref()
                .is_none_or(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        }) && [self.fps, self.video_bitrate_kbps, self.audio_bitrate_kbps]
            .into_iter()
            .all(|v| v.is_none_or(|n| n.is_finite() && n > 0.0 && n <= 1_000_000.0))
    }
}
