//! Stable component inventory models shared by discovery and the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentKind {
    YtDlp,
    Ffmpeg,
    Ffprobe,
    JavaScriptRuntime,
}

impl ComponentKind {
    pub const ALL: [Self; 4] = [
        Self::YtDlp,
        Self::Ffmpeg,
        Self::Ffprobe,
        Self::JavaScriptRuntime,
    ];

    pub const fn display_name(self) -> &'static str {
        match self {
            Self::YtDlp => "yt-dlp",
            Self::Ffmpeg => "FFmpeg",
            Self::Ffprobe => "ffprobe",
            Self::JavaScriptRuntime => "JavaScript runtime",
        }
    }

    pub const fn executable_names(self) -> &'static [&'static str] {
        match self {
            Self::YtDlp => &["yt-dlp", "yt-dlp.exe"],
            Self::Ffmpeg => &["ffmpeg", "ffmpeg.exe"],
            Self::Ffprobe => &["ffprobe", "ffprobe.exe"],
            Self::JavaScriptRuntime => &[
                "deno", "deno.exe", "node", "node.exe", "bun", "bun.exe", "qjs", "qjs.exe",
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentSource {
    AppManaged,
    System,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentStatus {
    Missing,
    Available,
    Outdated,
    Unhealthy,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentInstallation {
    pub kind: ComponentKind,
    pub source: Option<ComponentSource>,
    pub status: ComponentStatus,
    pub executable_path: Option<String>,
    pub version: Option<String>,
}

impl ComponentInstallation {
    pub const fn missing(kind: ComponentKind) -> Self {
        Self {
            kind,
            source: None,
            status: ComponentStatus::Missing,
            executable_path: None,
            version: None,
        }
    }
}
