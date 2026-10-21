//! Fixed yt-dlp argument construction for single-video downloads.

use std::{ffi::OsString, path::Path};

use crate::domain::{
    download::DownloadOptions,
    error::{AppError, ErrorCode},
};

const DOWNLOAD_PROGRESS_TEMPLATE: &str = concat!(
    "download:SB_PROGRESS:{\"downloadedBytes\":\"%(progress.downloaded_bytes)s\",",
    "\"totalBytes\":\"%(progress.total_bytes)s\",",
    "\"totalBytesEstimate\":\"%(progress.total_bytes_estimate)s\",",
    "\"speed\":\"%(progress.speed)s\",\"eta\":\"%(progress.eta)s\"}"
);

/// Builds a fixed, shell-free argv for a single media item.
pub fn build_download_args(options: &DownloadOptions) -> Result<Vec<OsString>, AppError> {
    validate_url(&options.url)?;
    validate_format_selector(&options.format_id)?;

    let output_directory = Path::new(&options.output_directory);
    if !output_directory.is_absolute()
        || options.output_directory.contains('\0')
        || !output_directory.is_dir()
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "请选择一个已存在且可访问的下载目录。",
            false,
        ));
    }

    let args = vec![
        "--ignore-config".into(),
        "--no-warnings".into(),
        "--no-playlist".into(),
        "--no-overwrites".into(),
        "--newline".into(),
        "--progress".into(),
        "--progress-template".into(),
        DOWNLOAD_PROGRESS_TEMPLATE.into(),
        "--progress-template".into(),
        "postprocess:SB_PROGRESS:post_processing".into(),
        "--format".into(),
        options.format_id.clone().into(),
        "--paths".into(),
        format!("home:{}", options.output_directory).into(),
        "--output".into(),
        "%(title)s [%(id)s].%(ext)s".into(),
        "--".into(),
        options.url.clone().into(),
    ];

    if options
        .subtitle_languages
        .iter()
        .any(|language| !language.trim().is_empty())
    {
        return Err(AppError::new(
            ErrorCode::Unknown,
            "当前版本尚未启用字幕下载选项。",
            false,
        ));
    }
    Ok(args)
}

fn validate_url(url: &str) -> Result<(), AppError> {
    if url.len() <= 4096 && (url.starts_with("http://") || url.starts_with("https://")) {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidUrl,
            "请输入有效的 http 或 https 视频链接。",
            false,
        ))
    }
}

fn validate_format_selector(selector: &str) -> Result<(), AppError> {
    let valid = !selector.is_empty()
        && selector.len() <= 256
        && selector.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b',' | b'+' | b'-')
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidPath,
            "所选媒体格式无效，请重新解析后选择格式。",
            false,
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use crate::domain::download::DownloadOptions;

    use super::{DOWNLOAD_PROGRESS_TEMPLATE, build_download_args};

    fn temp_directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "savebeam-download-args-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&path).expect("temporary directory should be created");
        path
    }

    fn options(directory: &std::path::Path) -> DownloadOptions {
        DownloadOptions {
            url: "https://example.com/watch?v=a&b=c".into(),
            format_id: "bestvideo+bestaudio".into(),
            output_directory: directory.to_string_lossy().into_owned(),
            subtitle_languages: Vec::new(),
        }
    }

    #[test]
    fn builds_fixed_argv_and_keeps_urls_and_paths_as_single_values() {
        let directory = temp_directory();
        let args = build_download_args(&options(&directory)).expect("valid options should build");
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();

        assert!(strings.contains(&"--ignore-config".into()));
        assert!(strings.contains(&"--no-playlist".into()));
        assert!(strings.contains(&"--no-overwrites".into()));
        assert!(strings.contains(&"--format".into()));
        assert!(strings.contains(&"bestvideo+bestaudio".into()));
        assert!(strings.contains(&DOWNLOAD_PROGRESS_TEMPLATE.into()));
        assert!(strings.contains(&format!("home:{}", directory.display()).into()));
        assert_eq!(
            strings.last().map(|arg| arg.as_ref()),
            Some("https://example.com/watch?v=a&b=c")
        );
        assert!(strings.contains(&"--".into()));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_selector_syntax_that_could_enable_unintended_options() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.format_id = "best;--exec=touch /tmp/pwned".into();
        assert!(build_download_args(&download_options).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_missing_output_directory_and_non_http_url() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.output_directory =
            directory.join("missing").to_string_lossy().into_owned();
        assert!(build_download_args(&download_options).is_err());
        download_options.output_directory = directory.to_string_lossy().into_owned();
        download_options.url = "file:///etc/passwd".into();
        assert!(build_download_args(&download_options).is_err());
        let _ = fs::remove_dir_all(directory);
    }
}
