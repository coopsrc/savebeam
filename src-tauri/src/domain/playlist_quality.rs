use serde::{Deserialize, Serialize};

use super::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistQuality {
    #[serde(default)]
    pub automatic_recommendations: bool,
    pub resolution_height: Option<u32>,
    pub frame_rate: Option<u32>,
    pub video_extension: Option<String>,
    pub video_codec: Option<String>,
    pub audio_extension: Option<String>,
    pub audio_codec: Option<String>,
    // Retained for persisted policies from the previous ceiling-based UI.
    pub max_height: Option<u32>,
    pub max_video_bitrate_kbps: Option<u32>,
    pub max_audio_bitrate_kbps: Option<u32>,
    #[serde(default)]
    pub allow_exceed: bool,
}

impl PlaylistQuality {
    pub fn validate(&self) -> Result<(), AppError> {
        if self
            .resolution_height
            .is_some_and(|v| !(144..=8640).contains(&v))
            || self.frame_rate.is_some_and(|v| !(1..=240).contains(&v))
            || self.max_height.is_some_and(|v| !(144..=8640).contains(&v))
            || self
                .max_video_bitrate_kbps
                .is_some_and(|v| !(100..=200_000).contains(&v))
            || self
                .max_audio_bitrate_kbps
                .is_some_and(|v| !(32..=1536).contains(&v))
        {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "系列画质策略超出允许范围，请重新选择。",
                false,
            ));
        }
        for (value, allowed) in [
            (
                &self.video_extension,
                &["mp4", "webm", "mkv", "mov", "flv", "ts", "m4v"][..],
            ),
            (
                &self.audio_extension,
                &[
                    "m4a", "webm", "mp3", "ogg", "opus", "flac", "wav", "mp4", "aac",
                ][..],
            ),
            (
                &self.video_codec,
                &["h264", "hevc", "av1", "vp9", "vp8", "mpeg4"][..],
            ),
            (
                &self.audio_codec,
                &[
                    "aac", "opus", "vorbis", "mp3", "flac", "alac", "ac3", "eac3", "pcm",
                ][..],
            ),
        ] {
            if value
                .as_deref()
                .is_some_and(|value| !allowed.contains(&value))
            {
                return Err(AppError::new(
                    ErrorCode::InvalidPath,
                    "音视频格式或编码选项无效，请重新选择。",
                    false,
                ));
            }
        }
        Ok(())
    }
}
