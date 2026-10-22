use serde::{Deserialize, Serialize};

use super::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistQuality {
    pub max_height: Option<u32>,
    pub max_video_bitrate_kbps: Option<u32>,
    pub max_audio_bitrate_kbps: Option<u32>,
    #[serde(default)]
    pub allow_exceed: bool,
}

impl PlaylistQuality {
    pub fn validate(&self) -> Result<(), AppError> {
        if self.max_height.is_some_and(|v| !(144..=8640).contains(&v))
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
        Ok(())
    }
}
