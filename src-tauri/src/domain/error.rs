//! User-safe application errors crossing the IPC boundary.

use std::fmt;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidUrl,
    UnsupportedUrl,
    ComponentMissing,
    ComponentTooOld,
    InvalidPath,
    VideoUnavailable,
    LoginRequired,
    PrivateContent,
    RateLimited,
    NetworkFailure,
    DiskFull,
    PermissionDenied,
    MergeFailed,
    Cancelled,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic: Option<String>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
            diagnostic: None,
        }
    }

    pub fn with_diagnostic(mut self, diagnostic: impl Into<String>) -> Self {
        self.diagnostic = Some(crate::security::redaction::redact_diagnostic(
            &diagnostic.into(),
        ));
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::{AppError, ErrorCode};

    #[test]
    fn serializes_a_stable_user_safe_error_shape() {
        let error = AppError::new(ErrorCode::NetworkFailure, "Network unavailable", true)
            .with_diagnostic("request timed out");
        let value = serde_json::to_value(error).expect("application error should serialize");

        assert_eq!(value["code"], "network_failure");
        assert_eq!(value["message"], "Network unavailable");
        assert_eq!(value["retryable"], true);
        assert_eq!(value["diagnostic"], "request timed out");
    }

    #[test]
    fn omits_diagnostic_when_none_is_available() {
        let error = AppError::new(ErrorCode::InvalidUrl, "Enter a valid URL", false);
        let value = serde_json::to_value(error).expect("application error should serialize");

        assert!(value.get("diagnostic").is_none());
    }

    #[test]
    fn display_never_includes_diagnostic_details() {
        let error = AppError::new(ErrorCode::Unknown, "Something went wrong", false)
            .with_diagnostic("sensitive process output");

        assert_eq!(error.to_string(), "Something went wrong");
    }
}
