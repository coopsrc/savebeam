//! Stable contracts shared by Tauri commands and event publishers.

use serde::Serialize;

use crate::domain::error::AppError;

pub const EVENT_SCHEMA_VERSION: u16 = 1;

pub const COMPONENT_STATE_CHANGED_EVENT: &str = "component://state-changed";
pub const COMPONENT_INSTALL_PROGRESS_EVENT: &str = "component://install-progress";
pub const DOWNLOAD_STATE_CHANGED_EVENT: &str = "download://state-changed";
pub const DOWNLOAD_PROGRESS_EVENT: &str = "download://progress";
pub const DOWNLOAD_LOG_EVENT: &str = "download://log";
pub const DOWNLOAD_ERROR_EVENT: &str = "download://error";
pub const DOWNLOAD_RESULT_EVENT: &str = "download://result";
pub const DOWNLOAD_REMOVED_EVENT: &str = "download://removed";

/// Commands return their success value directly and serialize `AppError` on
/// failure. A second success/error envelope is intentionally avoided.
pub type CommandResult<T> = Result<T, AppError>;

/// Versioned envelope for every event sent from Rust to the webview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPayload<T> {
    pub schema_version: u16,
    pub payload: T,
}

impl<T> EventPayload<T> {
    pub fn new(payload: T) -> Self {
        Self {
            schema_version: EVENT_SCHEMA_VERSION,
            payload,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde::Serialize;

    use super::{EVENT_SCHEMA_VERSION, EventPayload};

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TestPayload {
        task_id: &'static str,
    }

    #[test]
    fn event_payload_uses_a_versioned_camel_case_envelope() {
        let value = serde_json::to_value(EventPayload::new(TestPayload { task_id: "task-1" }))
            .expect("event payload should serialize");

        assert_eq!(value["schemaVersion"], EVENT_SCHEMA_VERSION);
        assert_eq!(value["payload"]["taskId"], "task-1");
    }
}
