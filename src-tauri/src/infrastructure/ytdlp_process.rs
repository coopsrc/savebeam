//! yt-dlp process adapter for metadata-only inspection.

use std::{path::PathBuf, process::Command};

use serde_json::Value;

use crate::domain::error::{AppError, ErrorCode};

#[derive(Debug, Clone)]
pub struct YtDlpProcessEngine {
    executable_path: PathBuf,
    javascript_runtime_path: Option<PathBuf>,
}

impl YtDlpProcessEngine {
    pub fn new(
        executable_path: impl Into<PathBuf>,
        javascript_runtime_path: Option<PathBuf>,
    ) -> Self {
        Self {
            executable_path: executable_path.into(),
            javascript_runtime_path,
        }
    }

    /// Reads yt-dlp JSON without downloading media or loading user configuration.
    pub fn inspect(&self, url: &str) -> Result<Value, AppError> {
        if url.len() > 4096 || !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(AppError::new(
                ErrorCode::InvalidUrl,
                "请输入有效的 http 或 https 视频链接。",
                false,
            ));
        }

        let mut command = Command::new(&self.executable_path);
        command.args([
            "--ignore-config",
            "--no-warnings",
            "--no-progress",
            "--no-playlist",
            "--dump-single-json",
            "--skip-download",
        ]);

        if let Some(runtime_path) = &self.javascript_runtime_path
            && let Some(runtime) = runtime_argument(runtime_path)
        {
            command.arg("--js-runtimes").arg(runtime);
        }

        let output = command.arg(url).output().map_err(|_| {
            AppError::new(
                ErrorCode::ComponentMissing,
                "无法启动 yt-dlp，请检查组件路径。",
                false,
            )
        })?;

        if !output.status.success() {
            return Err(AppError::new(
                ErrorCode::VideoUnavailable,
                "无法读取此视频信息；请检查链接、网络和访问权限。",
                true,
            ));
        }

        serde_json::from_slice(&output.stdout).map_err(|_| {
            AppError::new(
                ErrorCode::Unknown,
                "yt-dlp 返回了无法识别的媒体信息。",
                true,
            )
        })
    }
}

fn runtime_argument(path: &std::path::Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    let runtime = match name {
        "deno" => "deno",
        "node" => "node",
        "bun" => "bun",
        "qjs" => "quickjs",
        _ => return None,
    };
    Some(format!("{runtime}:{}", path.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::domain::error::ErrorCode;

    use super::YtDlpProcessEngine;

    #[cfg(unix)]
    fn write_script(name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!(
            "savebeam-ytdlp-engine-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("fake executable directory should be created");
        let executable = directory.join(name);
        fs::write(&executable, format!("#!/bin/sh\n{body}\n"))
            .expect("fake executable should be written");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .expect("fake executable should be executable");
        executable
    }

    #[cfg(unix)]
    #[test]
    fn inspect_passes_fixed_flags_and_url_as_a_single_argument() {
        let executable = write_script(
            "yt-dlp",
            "[ \"$1\" = \"--ignore-config\" ] || exit 11\n[ \"$5\" = \"--dump-single-json\" ] || exit 12\n[ \"$7\" = \"https://example.com/watch?v=one&x=two\" ] || exit 13\nprintf '{\\\"id\\\":\\\"demo\\\",\\\"title\\\":\\\"Example\\\"}'",
        );
        let engine = YtDlpProcessEngine::new(&executable, None);

        let value = engine
            .inspect("https://example.com/watch?v=one&x=two")
            .expect("metadata JSON should be returned");

        assert_eq!(value["id"], "demo");
        assert_eq!(value["title"], "Example");
        let _ = fs::remove_dir_all(
            executable
                .parent()
                .expect("fake executable has a directory"),
        );
    }

    #[cfg(unix)]
    #[test]
    fn inspect_rejects_invalid_schemes_without_starting_a_process() {
        let executable = write_script("yt-dlp", "exit 1");
        let engine = YtDlpProcessEngine::new(&executable, None);

        let error = engine
            .inspect("file:///etc/passwd")
            .expect_err("file URLs must be rejected");

        assert_eq!(error.code, ErrorCode::InvalidUrl);
        let _ = fs::remove_dir_all(
            executable
                .parent()
                .expect("fake executable has a directory"),
        );
    }
}
