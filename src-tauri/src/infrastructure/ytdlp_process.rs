//! yt-dlp process adapter for metadata-only inspection.

use std::{
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::Value;

use crate::domain::error::{AppError, ErrorCode};

const INSPECT_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

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
        self.inspect_cancellable(url, &CancellationToken::default())
    }

    pub fn inspect_cancellable(
        &self,
        url: &str,
        cancellation: &CancellationToken,
    ) -> Result<Value, AppError> {
        self.inspect_with_timeout(url, cancellation, INSPECT_TIMEOUT)
    }

    fn inspect_with_timeout(
        &self,
        url: &str,
        cancellation: &CancellationToken,
        timeout: Duration,
    ) -> Result<Value, AppError> {
        if url.len() > 4096 || !(url.starts_with("http://") || url.starts_with("https://")) {
            return Err(AppError::new(
                ErrorCode::InvalidUrl,
                "请输入有效的 http 或 https 视频链接。",
                false,
            ));
        }

        let mut command = Command::new(&self.executable_path);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command.args([
            "--ignore-config",
            "--no-warnings",
            "--no-progress",
            "--flat-playlist",
            "--playlist-end",
            "51",
            "--dump-single-json",
            "--skip-download",
        ]);

        if let Some(runtime_path) = &self.javascript_runtime_path
            && let Some(runtime) = runtime_argument(runtime_path)
        {
            command.arg("--js-runtimes").arg(runtime);
        }

        let mut child = command.arg(url).spawn().map_err(|_| {
            AppError::new(
                ErrorCode::ComponentMissing,
                "无法启动 yt-dlp，请检查组件路径。",
                false,
            )
        })?;
        let stdout = child.stdout.take().expect("stdout is piped");
        let stderr = child.stderr.take().expect("stderr is piped");
        let stdout_reader = thread::spawn(move || read_capped(stdout, MAX_JSON_BYTES));
        let stderr_reader = thread::spawn(move || read_capped(stderr, MAX_STDERR_BYTES));
        let started_at = Instant::now();
        let status = loop {
            if cancellation.is_cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(AppError::new(
                    ErrorCode::Cancelled,
                    "已取消媒体信息读取。",
                    false,
                ));
            }
            if started_at.elapsed() >= timeout {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(AppError::new(
                    ErrorCode::NetworkFailure,
                    "读取媒体信息超时，请检查网络后重试。",
                    true,
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => thread::sleep(Duration::from_millis(25)),
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(AppError::new(
                        ErrorCode::Unknown,
                        "无法读取 yt-dlp 进程状态。",
                        true,
                    ));
                }
            }
        };
        let stdout = stdout_reader.join().unwrap_or_default();
        let stderr = stderr_reader.join().unwrap_or_default();

        if stdout.truncated {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "媒体信息过大，无法安全解析。",
                false,
            ));
        }

        if !status.success() {
            return Err(classify_process_error(&stderr.bytes));
        }

        serde_json::from_slice(&stdout.bytes).map_err(|_| {
            AppError::new(
                ErrorCode::Unknown,
                "yt-dlp 返回了无法识别的媒体信息。",
                true,
            )
        })
    }
}

#[derive(Debug, Default)]
struct CappedOutput {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_capped(mut reader: impl Read, limit: usize) -> CappedOutput {
    let mut output = CappedOutput::default();
    let mut buffer = [0_u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = limit.saturating_sub(output.bytes.len());
                output
                    .bytes
                    .extend_from_slice(&buffer[..count.min(remaining)]);
                output.truncated |= count > remaining;
            }
        }
    }
    output
}

pub(crate) fn classify_process_error(stderr: &[u8]) -> AppError {
    let stderr = String::from_utf8_lossy(stderr).to_ascii_lowercase();
    if stderr.contains("sign in")
        || stderr.contains("login required")
        || stderr.contains("authentication required")
        || stderr.contains("cookies are needed")
    {
        return AppError::new(
            ErrorCode::LoginRequired,
            "此视频需要登录后才能读取。",
            false,
        );
    }
    if stderr.contains("private video") || stderr.contains("video is private") {
        return AppError::new(
            ErrorCode::PrivateContent,
            "此视频为私有内容，无法读取。",
            false,
        );
    }
    if stderr.contains("429") || stderr.contains("too many requests") {
        return AppError::new(ErrorCode::RateLimited, "请求过于频繁，请稍后重试。", true);
    }
    if stderr.contains("unsupported url") {
        return AppError::new(
            ErrorCode::UnsupportedUrl,
            "暂不支持此网站或链接类型。",
            false,
        );
    }
    if stderr.contains("timed out")
        || stderr.contains("connection")
        || stderr.contains("network is unreachable")
        || stderr.contains("unable to download webpage")
    {
        return AppError::new(
            ErrorCode::NetworkFailure,
            "网络连接失败，请检查网络后重试。",
            true,
        );
    }
    AppError::new(
        ErrorCode::VideoUnavailable,
        "无法读取此视频；请检查链接、访问权限或视频可用性。",
        true,
    )
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
    use crate::services::media_mapper::map_media_info;

    use super::{CancellationToken, YtDlpProcessEngine, classify_process_error};

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
            "[ \"$1\" = \"--ignore-config\" ] || exit 11\n[ \"$4\" = \"--flat-playlist\" ] || exit 12\n[ \"$5\" = \"--playlist-end\" ] || exit 13\n[ \"$6\" = \"51\" ] || exit 14\n[ \"$7\" = \"--dump-single-json\" ] || exit 15\n[ \"$9\" = \"https://example.com/watch?v=one&x=two\" ] || exit 16\nprintf '{\\\"id\\\":\\\"demo\\\",\\\"title\\\":\\\"Example\\\"}'",
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

    #[cfg(unix)]
    #[test]
    fn cancellation_terminates_a_running_metadata_process() {
        let executable = write_script("yt-dlp", "exec sleep 5");
        let engine = YtDlpProcessEngine::new(&executable, None);
        let cancellation = CancellationToken::default();
        let worker_token = cancellation.clone();
        let worker = std::thread::spawn(move || {
            engine.inspect_cancellable("https://example.com/video", &worker_token)
        });

        std::thread::sleep(std::time::Duration::from_millis(100));
        cancellation.cancel();
        let error = worker
            .join()
            .expect("inspection worker should finish")
            .expect_err("cancelled inspection should return an error");

        assert_eq!(error.code, ErrorCode::Cancelled);
        let _ = fs::remove_dir_all(
            executable
                .parent()
                .expect("fake executable has a directory"),
        );
    }

    #[cfg(unix)]
    #[test]
    fn inspection_timeout_terminates_the_child_and_returns_network_error() {
        let executable = write_script("yt-dlp", "exec sleep 5");
        let engine = YtDlpProcessEngine::new(&executable, None);
        let started_at = std::time::Instant::now();
        let error = engine
            .inspect_with_timeout(
                "https://example.com/video",
                &CancellationToken::default(),
                std::time::Duration::from_millis(75),
            )
            .expect_err("slow inspection should time out");

        assert_eq!(error.code, ErrorCode::NetworkFailure);
        assert!(started_at.elapsed() < std::time::Duration::from_secs(2));
        let _ = fs::remove_dir_all(
            executable
                .parent()
                .expect("fake executable has a directory"),
        );
    }

    #[test]
    fn classifies_authentication_network_and_unavailable_errors_without_echoing_stderr() {
        assert_eq!(
            classify_process_error(b"Sign in to confirm your age").code,
            ErrorCode::LoginRequired
        );
        let network_error = classify_process_error(b"Connection timed out at secret-url");
        assert_eq!(network_error.code, ErrorCode::NetworkFailure);
        assert!(!network_error.message.contains("secret-url"));
        assert_eq!(
            classify_process_error(b"No formats found").code,
            ErrorCode::VideoUnavailable
        );
    }

    #[cfg(unix)]
    #[test]
    fn fake_executable_json_maps_to_the_stable_media_model() {
        let executable = write_script(
            "yt-dlp",
            "[ \"$1\" = \"--ignore-config\" ] || exit 10\n[ \"$9\" = \"https://example.com/watch?v=demo\" ] || exit 11\nprintf '%s' '{\"id\":\"demo\",\"title\":\"Integration video\",\"webpage_url\":\"https://example.com/watch?v=demo\",\"formats\":[{\"format_id\":\"18\",\"ext\":\"mp4\",\"height\":720,\"vcodec\":\"avc1\",\"acodec\":\"mp4a\"}],\"subtitles\":{\"en\":[{\"ext\":\"vtt\"}]}}'",
        );
        let url = "https://example.com/watch?v=demo";
        let raw = YtDlpProcessEngine::new(&executable, None)
            .inspect(url)
            .expect("fake yt-dlp should return JSON");
        let media = map_media_info(&raw, url).expect("fake JSON should map");

        assert_eq!(media.id, "demo");
        assert_eq!(media.title, "Integration video");
        assert_eq!(media.formats[0].resolution.as_deref(), Some("720p"));
        assert_eq!(media.subtitles[0].language, "en");
        let _ = fs::remove_dir_all(
            executable
                .parent()
                .expect("fake executable has a directory"),
        );
    }

    #[cfg(unix)]
    #[test]
    fn fake_executable_error_output_is_classified() {
        let executable = write_script("yt-dlp", "echo 'This video is private' >&2\nexit 1");
        let error = YtDlpProcessEngine::new(&executable, None)
            .inspect("https://example.com/private")
            .expect_err("private media should fail inspection");

        assert_eq!(error.code, ErrorCode::PrivateContent);
        let _ = fs::remove_dir_all(
            executable
                .parent()
                .expect("fake executable has a directory"),
        );
    }
}
