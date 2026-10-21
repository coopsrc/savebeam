//! Verifies yt-dlp's reported final files before completing a task.

use std::path::Path;

use crate::{
    domain::{
        download::DownloadResult,
        error::{AppError, ErrorCode},
    },
    infrastructure::process_supervisor::ProcessOutput,
};

pub fn verify_download_outputs(
    output: ProcessOutput,
    task_id: &str,
    title: &str,
    output_directory: &Path,
) -> Result<DownloadResult, AppError> {
    let expected_directory = output_directory.canonicalize().map_err(|error| {
        AppError::new(ErrorCode::InvalidPath, "下载目录不可访问。", false)
            .with_diagnostic(error.to_string())
    })?;
    if output.output_paths.is_empty() {
        return Err(AppError::new(
            ErrorCode::MergeFailed,
            "下载进程结束，但没有返回最终媒体文件。",
            true,
        ));
    }

    let mut paths = Vec::new();
    let mut total_bytes = 0_u64;
    for reported_path in output.output_paths {
        let path = Path::new(&reported_path).canonicalize().map_err(|error| {
            AppError::new(ErrorCode::MergeFailed, "未找到下载完成的媒体文件。", true)
                .with_diagnostic(error.to_string())
        })?;
        if !path.starts_with(&expected_directory) {
            return Err(AppError::new(
                ErrorCode::PermissionDenied,
                "下载输出位置超出所选目录，已拒绝标记为完成。",
                false,
            ));
        }
        let metadata = path.metadata().map_err(|error| {
            AppError::new(ErrorCode::MergeFailed, "无法读取下载文件信息。", true)
                .with_diagnostic(error.to_string())
        })?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(AppError::new(
                ErrorCode::MergeFailed,
                "下载生成的媒体文件为空或无效。",
                true,
            ));
        }
        total_bytes = total_bytes.saturating_add(metadata.len());
        paths.push(path.to_string_lossy().into_owned());
    }

    Ok(DownloadResult {
        task_id: task_id.to_owned(),
        title: title.to_owned(),
        output_paths: paths,
        total_bytes,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::infrastructure::process_supervisor::ProcessOutput;

    use super::verify_download_outputs;

    fn temp_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "savebeam-output-verify-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("temporary directory should be created");
        path
    }

    #[test]
    fn accepts_nonempty_final_files_and_calculates_size() {
        let directory = temp_directory();
        let output = directory.join("Example [id].mp4");
        fs::write(&output, b"media bytes").expect("fixture media should be written");

        let result = verify_download_outputs(
            ProcessOutput {
                output_paths: vec![output.to_string_lossy().into_owned()],
            },
            "task-1",
            "Example",
            &directory,
        )
        .expect("existing output should verify");

        assert_eq!(result.task_id, "task-1");
        assert_eq!(result.total_bytes, 11);
        assert_eq!(result.output_paths.len(), 1);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_missing_empty_and_out_of_directory_outputs() {
        let directory = temp_directory();
        let missing = directory.join("missing.mp4");
        assert!(
            verify_download_outputs(
                ProcessOutput {
                    output_paths: vec![missing.to_string_lossy().into_owned()]
                },
                "task-1",
                "Example",
                &directory
            )
            .is_err()
        );

        let empty = directory.join("empty.mp4");
        fs::write(&empty, []).expect("empty fixture should be written");
        assert!(
            verify_download_outputs(
                ProcessOutput {
                    output_paths: vec![empty.to_string_lossy().into_owned()]
                },
                "task-1",
                "Example",
                &directory
            )
            .is_err()
        );

        let outside = std::env::temp_dir().join(format!("savebeam-outside-{}", std::process::id()));
        fs::write(&outside, b"outside").expect("outside fixture should be written");
        assert!(
            verify_download_outputs(
                ProcessOutput {
                    output_paths: vec![outside.to_string_lossy().into_owned()]
                },
                "task-1",
                "Example",
                &directory
            )
            .is_err()
        );
        let _ = fs::remove_file(outside);
        let _ = fs::remove_dir_all(directory);
    }
}
