//! App-wide media networking preferences; never embedded in task rows.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyMode {
    #[default]
    Default,
    Direct,
    Custom,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
pub struct NetworkPreferences {
    pub proxy_mode: ProxyMode,
    pub proxy_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionCheckStatus {
    Success,
    Failed,
    Limited,
    Skipped,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCheck {
    pub status: ConnectionCheckStatus,
    pub message: String,
    pub duration_ms: Option<u64>,
    pub http_status: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConnectionTestResult {
    pub proxy: ConnectionCheck,
    pub youtube: ConnectionCheck,
}
