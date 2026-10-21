//! User-initiated, privacy-bounded diagnostics export.

use std::{fs, path::Path, time::SystemTime};

use serde::Serialize;
use tauri::State;

use crate::{
    commands::ipc::CommandResult,
    domain::{
        download::DownloadTaskStatus,
        error::{AppError, ErrorCode},
    },
    services::download_registry::DownloadTaskRegistry,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticReport {
    schema_version: u16,
    generated_at_unix_ms: u128,
    app_version: String,
    operating_system: &'static str,
    architecture: &'static str,
    task_count: usize,
    task_status_counts: TaskStatusCounts,
    privacy: &'static str,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskStatusCounts {
    queued: usize,
    preparing: usize,
    downloading: usize,
    post_processing: usize,
    completed: usize,
    failed: usize,
    cancelling: usize,
    cancelled: usize,
}

impl TaskStatusCounts {
    fn add(&mut self, status: DownloadTaskStatus) {
        match status {
            DownloadTaskStatus::Queued => self.queued += 1,
            DownloadTaskStatus::Preparing => self.preparing += 1,
            DownloadTaskStatus::Downloading => self.downloading += 1,
            DownloadTaskStatus::PostProcessing => self.post_processing += 1,
            DownloadTaskStatus::Completed => self.completed += 1,
            DownloadTaskStatus::Failed => self.failed += 1,
            DownloadTaskStatus::Cancelling => self.cancelling += 1,
            DownloadTaskStatus::Cancelled => self.cancelled += 1,
        }
    }
}

#[tauri::command]
pub fn export_diagnostics(
    destination: String,
    tasks: State<'_, DownloadTaskRegistry>,
    app: tauri::AppHandle,
) -> CommandResult<()> {
    let destination = Path::new(destination.trim());
    if destination
        .extension()
        .and_then(|extension| extension.to_str())
        != Some("json")
        || !destination.is_absolute()
        || !destination.parent().is_some_and(Path::is_dir)
        || destination.file_name().is_none()
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "请选择有效的 JSON 诊断文件保存位置。",
            false,
        ));
    }

    let task_list = tasks.list()?;
    let mut task_status_counts = TaskStatusCounts::default();
    for task in &task_list {
        task_status_counts.add(task.status);
    }
    let generated_at_unix_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))?
        .as_millis();
    let report = DiagnosticReport {
        schema_version: 1,
        generated_at_unix_ms,
        app_version: app.package_info().version.to_string(),
        operating_system: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        task_count: task_list.len(),
        task_status_counts,
        privacy: "Contains app version, OS, architecture, and task status counts only. Does not contain URLs, titles, file paths, cookies, or process output.",
    };
    let json = serde_json::to_vec_pretty(&report).map_err(|error| {
        AppError::new(ErrorCode::Unknown, "无法生成诊断文件。", false)
            .with_diagnostic(error.to_string())
    })?;
    fs::write(destination, json).map_err(|error| {
        AppError::new(ErrorCode::PermissionDenied, "无法写入所选诊断文件。", true)
            .with_diagnostic(error.to_string())
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{DiagnosticReport, TaskStatusCounts};

    #[test]
    fn report_schema_explicitly_excludes_user_content_and_paths() {
        let report = DiagnosticReport {
            schema_version: 1,
            generated_at_unix_ms: 123,
            app_version: "0.1.0".into(),
            operating_system: "macos",
            architecture: "aarch64",
            task_count: 0,
            task_status_counts: TaskStatusCounts::default(),
            privacy: "Only technical status information.",
        };
        let json = serde_json::to_value(report).expect("report should serialize");
        assert!(json.get("urls").is_none());
        assert!(json.get("cookies").is_none());
        assert!(json.get("paths").is_none());
        assert_eq!(json["schemaVersion"], 1);
    }
}
