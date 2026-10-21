//! Supervision and bounded structured-output parsing for yt-dlp downloads.

use std::{
    ffi::OsString,
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver, SyncSender},
    thread::{self, JoinHandle},
    time::Duration,
};

use serde::Deserialize;
use serde_json::Value;

use crate::{
    domain::{
        download::{DownloadProgress, DownloadTaskStatus},
        error::{AppError, ErrorCode},
    },
    infrastructure::ytdlp_process::{CancellationToken, classify_process_error},
};

const MAX_LINE_BYTES: usize = 16 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const PROGRESS_MARKER: &str = "SB_PROGRESS:";
const RESULT_MARKER: &str = "SB_RESULT:";
const PARTS_MARKER: &str = "SB_PARTS:";

#[derive(Debug, Clone, PartialEq, Eq)]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug)]
struct OutputLine {
    stream: OutputStream,
    bytes: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct ProcessOutput {
    pub output_paths: Vec<String>,
    pub intermediate_files: Vec<IntermediateFiles>,
}

#[derive(Debug, Deserialize)]
pub struct IntermediateFiles {
    pub output: String,
    pub streams: Vec<IntermediateStream>,
}

/// Minimal yt-dlp projection: no URLs, headers, cookies, or full info JSON.
#[derive(Debug, Default, Deserialize)]
pub struct IntermediateStream {
    pub filepath: Option<String>,
    pub format_id: Option<String>,
    pub ext: Option<String>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub resolution: Option<String>,
    pub tbr: Option<f64>,
    pub vbr: Option<f64>,
    pub abr: Option<f64>,
}

pub struct ProcessSupervisor;

impl ProcessSupervisor {
    pub fn run(
        executable: &Path,
        arguments: &[OsString],
        task_id: &str,
        cancellation: &CancellationToken,
        mut on_progress: impl FnMut(DownloadProgress),
    ) -> Result<ProcessOutput, AppError> {
        let mut command = Command::new(executable);
        command
            .args(arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_process_group(&mut command);
        let mut child = command.spawn().map_err(|_| {
            AppError::new(
                ErrorCode::ComponentMissing,
                "无法启动 yt-dlp，请检查组件路径。",
                false,
            )
        })?;

        let (sender, receiver) = mpsc::sync_channel(128);
        let stdout_reader = start_reader(
            child.stdout.take().expect("stdout is piped"),
            OutputStream::Stdout,
            sender.clone(),
        );
        let stderr_reader = start_reader(
            child.stderr.take().expect("stderr is piped"),
            OutputStream::Stderr,
            sender,
        );
        let mut output = ProcessOutput::default();
        let mut stderr = Vec::new();

        let exit_status = loop {
            if cancellation.is_cancelled() {
                terminate_child(&mut child);
                drain_until_closed(
                    &receiver,
                    &mut output,
                    &mut stderr,
                    task_id,
                    &mut on_progress,
                );
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(AppError::new(
                    ErrorCode::Cancelled,
                    "下载任务已取消。",
                    false,
                ));
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if let Ok(line) = receiver.recv_timeout(Duration::from_millis(50)) {
                        handle_line(line, &mut output, &mut stderr, task_id, &mut on_progress);
                    }
                }
                Err(_) => {
                    terminate_child(&mut child);
                    drain_until_closed(
                        &receiver,
                        &mut output,
                        &mut stderr,
                        task_id,
                        &mut on_progress,
                    );
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(AppError::new(
                        ErrorCode::Unknown,
                        "无法读取下载进程状态。",
                        true,
                    ));
                }
            }
        };

        while let Ok(line) = receiver.recv() {
            handle_line(line, &mut output, &mut stderr, task_id, &mut on_progress);
        }
        let _ = stdout_reader.join();
        let _ = stderr_reader.join();

        if exit_status.success() {
            Ok(output)
        } else {
            Err(classify_process_error(&stderr))
        }
    }
}

fn start_reader(
    reader: impl Read + Send + 'static,
    stream: OutputStream,
    sender: SyncSender<OutputLine>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = reader;
        let mut chunk = [0_u8; 4096];
        let mut line = Vec::with_capacity(256);
        let mut too_long = false;
        loop {
            let read = match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => read,
            };
            for byte in &chunk[..read] {
                if *byte == b'\n' {
                    if !too_long {
                        let _ = sender.send(OutputLine {
                            stream: stream.clone(),
                            bytes: std::mem::take(&mut line),
                        });
                    }
                    line.clear();
                    too_long = false;
                } else if line.len() < MAX_LINE_BYTES {
                    line.push(*byte);
                } else {
                    too_long = true;
                }
            }
        }
        if !line.is_empty() && !too_long {
            let _ = sender.send(OutputLine {
                stream,
                bytes: line,
            });
        }
    })
}

fn drain_until_closed(
    receiver: &Receiver<OutputLine>,
    output: &mut ProcessOutput,
    stderr: &mut Vec<u8>,
    task_id: &str,
    on_progress: &mut impl FnMut(DownloadProgress),
) {
    loop {
        match receiver.recv_timeout(Duration::from_millis(50)) {
            Ok(line) => handle_line(line, output, stderr, task_id, on_progress),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
        }
    }
}

fn handle_line(
    line: OutputLine,
    output: &mut ProcessOutput,
    stderr: &mut Vec<u8>,
    task_id: &str,
    on_progress: &mut impl FnMut(DownloadProgress),
) {
    if line.stream == OutputStream::Stderr {
        let remaining = MAX_STDERR_BYTES.saturating_sub(stderr.len());
        stderr.extend_from_slice(&line.bytes[..line.bytes.len().min(remaining)]);
        stderr.push(b'\n');
    }
    let text = String::from_utf8_lossy(&line.bytes);
    if let Some(payload) = text
        .split_once(PROGRESS_MARKER)
        .map(|(_, payload)| payload.trim())
    {
        if payload == "post_processing" {
            on_progress(DownloadProgress {
                task_id: task_id.to_owned(),
                status: DownloadTaskStatus::PostProcessing,
                downloaded_bytes: None,
                total_bytes: None,
                speed_bytes_per_second: None,
                eta_seconds: None,
                post_processing: true,
            });
        } else if let Ok(value) = serde_json::from_str::<Value>(payload) {
            on_progress(progress_from_json(task_id, &value));
        }
    }
    if line.stream == OutputStream::Stdout
        && let Some(payload) = text
            .split_once(RESULT_MARKER)
            .map(|(_, payload)| payload.trim())
        && let Ok(path) = serde_json::from_str::<String>(payload)
        && !path.is_empty()
    {
        output.output_paths.push(path);
    }
    if line.stream == OutputStream::Stdout
        && output.intermediate_files.len() < 50
        && let Some(payload) = text.strip_prefix(PARTS_MARKER)
        && let Ok(group) = serde_json::from_str::<IntermediateFiles>(payload.trim())
        && group.streams.len() <= 8
    {
        output.intermediate_files.push(group);
    }
}

fn progress_from_json(task_id: &str, value: &Value) -> DownloadProgress {
    DownloadProgress {
        task_id: task_id.to_owned(),
        status: DownloadTaskStatus::Downloading,
        downloaded_bytes: parse_u64(value.get("downloadedBytes")),
        total_bytes: parse_u64(value.get("totalBytes"))
            .or_else(|| parse_u64(value.get("totalBytesEstimate"))),
        speed_bytes_per_second: parse_f64(value.get("speed")),
        eta_seconds: parse_f64(value.get("eta")),
        post_processing: false,
    }
}

fn parse_u64(value: Option<&Value>) -> Option<u64> {
    value?.as_str()?.parse().ok()
}

fn parse_f64(value: Option<&Value>) -> Option<f64> {
    let value: f64 = value?.as_str()?.parse().ok()?;
    (value.is_finite() && value >= 0.0).then_some(value)
}

fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    {
        let process_group = -(child.id() as i32);
        // The child is started in its own process group, so descendants such
        // as FFmpeg are stopped together with yt-dlp.
        let _ = unsafe { libc::kill(process_group, libc::SIGKILL) };
        let _ = child.wait();
    }
    #[cfg(not(unix))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn configure_process_group(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(not(unix))]
    let _ = command;
}

#[cfg(test)]
mod tests {
    use std::{
        ffi::OsString,
        fs,
        path::PathBuf,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::ProcessSupervisor;
    use crate::{
        domain::download::DownloadTaskStatus, infrastructure::ytdlp_process::CancellationToken,
    };

    #[test]
    fn parses_minimal_stream_metadata_and_ignores_invalid_or_stderr_records() {
        let mut output = super::ProcessOutput::default();
        let mut stderr = Vec::new();
        let record = r#"SB_PARTS:{"output":"/tmp/title.mp4","streams":[{"filepath":"/tmp/title.f30120.mp4","format_id":"30120","ext":"mp4","vcodec":"avc1","width":3840,"height":2160,"vbr":5500},{"filepath":"/tmp/title.f30280.m4a","format_id":"30280","ext":"m4a","acodec":"mp4a","vcodec":"none","abr":152}]}"#;
        for (stream, text) in [
            (super::OutputStream::Stdout, record),
            (super::OutputStream::Stderr, record),
            (super::OutputStream::Stdout, "SB_PARTS:invalid"),
        ] {
            super::handle_line(
                super::OutputLine {
                    stream,
                    bytes: text.as_bytes().to_vec(),
                },
                &mut output,
                &mut stderr,
                "task",
                &mut |_| {},
            );
        }
        assert_eq!(output.intermediate_files.len(), 1);
        let streams = &output.intermediate_files[0].streams;
        assert_eq!(streams[0].format_id.as_deref(), Some("30120"));
        assert_eq!(streams[1].abr, Some(152.0));
        assert_eq!(streams[1].height, None);
        assert!(output.output_paths.is_empty());
    }

    #[cfg(unix)]
    fn write_script(body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!(
            "savebeam-process-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&directory).expect("temporary directory should be created");
        let executable = directory.join("yt-dlp");
        fs::write(&executable, format!("#!/bin/sh\n{body}\n")).expect("script should be written");
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
            .expect("script should be executable");
        executable
    }

    #[cfg(unix)]
    #[test]
    fn parses_structured_progress_and_final_path_from_bounded_output_lines() {
        let executable = write_script(
            "printf '%s\\n' 'SB_PROGRESS:{\"downloadedBytes\":\"25\",\"totalBytes\":\"100\",\"totalBytesEstimate\":\"120\",\"speed\":\"5.5\",\"eta\":\"14\"}' >&2\nprintf '%s\\n' 'SB_PROGRESS:post_processing' >&2\nprintf '%s\\n' 'SB_RESULT:\"/tmp/Example [id].mp4\"'",
        );
        let mut progress = Vec::new();
        let output = ProcessSupervisor::run(
            &executable,
            &[OsString::from("https://example.com/video")],
            "task-1",
            &CancellationToken::default(),
            |event| progress.push(event),
        )
        .expect("fake download should succeed");

        assert_eq!(output.output_paths, ["/tmp/Example [id].mp4"]);
        assert_eq!(progress.len(), 2);
        assert_eq!(progress[0].downloaded_bytes, Some(25));
        assert_eq!(progress[0].total_bytes, Some(100));
        assert_eq!(progress[0].speed_bytes_per_second, Some(5.5));
        assert_eq!(progress[0].status, DownloadTaskStatus::Downloading);
        assert!(progress[1].post_processing);
        let _ = fs::remove_dir_all(executable.parent().expect("script has a parent"));
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_kills_the_entire_process_group() {
        let executable = write_script("sleep 5 &\nwait");
        let cancellation = CancellationToken::default();
        let child_token = cancellation.clone();
        let executable_path = executable.clone();
        let worker = std::thread::spawn(move || {
            ProcessSupervisor::run(&executable_path, &[], "task-2", &child_token, |_| {})
        });
        std::thread::sleep(Duration::from_millis(100));
        cancellation.cancel();
        let error = worker
            .join()
            .expect("worker should finish")
            .expect_err("cancelled download should fail");

        assert_eq!(error.code, crate::domain::error::ErrorCode::Cancelled);
        let _ = fs::remove_dir_all(executable.parent().expect("script has a parent"));
    }
}
