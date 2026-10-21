//! Bounded, cancellable HTTPS downloads for app-managed component archives.

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Serialize;

use crate::{
    domain::{
        component_manifest::ComponentRelease,
        error::{AppError, ErrorCode},
    },
    infrastructure::ytdlp_process::CancellationToken,
};

const MAX_COMPONENT_BYTES: u64 = 2_000_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDownloadProgress {
    pub component: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

pub fn download_to_temp(
    release: &ComponentRelease,
    destination: &Path,
    cancellation: &CancellationToken,
    mut on_progress: impl FnMut(ComponentDownloadProgress),
) -> Result<PathBuf, AppError> {
    if !release.url.starts_with("https://")
        || release.size_bytes == 0
        || release.size_bytes > MAX_COMPONENT_BYTES
        || destination.exists()
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "组件下载目标或发行信息无效。",
            false,
        ));
    }
    if cancellation.is_cancelled() {
        return Err(cancelled());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                attempt.stop()
            } else if attempt.url().scheme() == "https" {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|error| network_error(error.to_string()))?;
    let mut response = client
        .get(&release.url)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| network_error(error.to_string()))?;
    if response
        .content_length()
        .is_some_and(|length| length > release.size_bytes)
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "组件下载文件超过清单声明大小。",
            false,
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::new(ErrorCode::InvalidPath, "组件临时文件路径无效。", false))?;
    fs::create_dir_all(parent).map_err(|error| file_error("无法创建组件临时目录。", error))?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| file_error("无法创建组件临时文件。", error))?;
    let mut guard = PartialFile(Some(destination.to_path_buf()));
    let mut buffer = [0u8; 64 * 1024];
    let mut downloaded = 0u64;
    loop {
        if cancellation.is_cancelled() {
            return Err(cancelled());
        }
        let count = response
            .read(&mut buffer)
            .map_err(|error| network_error(error.to_string()))?;
        if count == 0 {
            break;
        }
        downloaded = downloaded.saturating_add(count as u64);
        if downloaded > release.size_bytes || downloaded > MAX_COMPONENT_BYTES {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "组件下载文件超过清单声明大小。",
                false,
            ));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| file_error("组件下载文件写入失败。", error))?;
        on_progress(ComponentDownloadProgress {
            component: release.kind.display_name().into(),
            downloaded_bytes: downloaded,
            total_bytes: release.size_bytes,
        });
    }
    output
        .flush()
        .and_then(|()| output.sync_all())
        .map_err(|error| file_error("组件下载文件无法保存。", error))?;
    if downloaded != release.size_bytes {
        return Err(AppError::new(
            ErrorCode::Unknown,
            "组件下载不完整，请检查网络后重试。",
            true,
        ));
    }
    guard.0 = None;
    Ok(destination.to_path_buf())
}

struct PartialFile(Option<PathBuf>);

impl Drop for PartialFile {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = fs::remove_file(path);
        }
    }
}

fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "组件下载已取消。", true)
}

fn network_error(diagnostic: String) -> AppError {
    AppError::new(ErrorCode::NetworkFailure, "无法从组件来源下载文件。", true)
        .with_diagnostic(diagnostic)
}

fn file_error(message: &str, error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::InvalidPath, message, true).with_diagnostic(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::download_to_temp;
    use crate::{
        domain::{
            component::ComponentKind,
            component_manifest::{Architecture, ArchiveKind, ComponentRelease, TargetOs},
        },
        infrastructure::ytdlp_process::CancellationToken,
    };

    fn release(url: &str) -> ComponentRelease {
        ComponentRelease {
            kind: ComponentKind::YtDlp,
            version: "test".into(),
            target_os: TargetOs::MacOs,
            architecture: Architecture::Aarch64,
            provider: "test".into(),
            url: url.into(),
            sha256: "a".repeat(64),
            size_bytes: 1,
            archive: ArchiveKind::Raw,
            executable_name: "yt-dlp".into(),
        }
    }

    #[test]
    fn rejects_plain_http_and_cancelled_transfers_without_creating_files() {
        let destination =
            std::env::temp_dir().join(format!("savebeam-component-{}.part", std::process::id()));
        assert!(
            download_to_temp(
                &release("http://example.com/tool"),
                &destination,
                &CancellationToken::default(),
                |_| {}
            )
            .is_err()
        );
        let cancellation = CancellationToken::default();
        cancellation.cancel();
        assert!(
            download_to_temp(
                &release("https://example.com/tool"),
                &destination,
                &cancellation,
                |_| {}
            )
            .is_err()
        );
        assert!(!destination.exists());
    }
}
