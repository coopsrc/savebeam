//! Fixed yt-dlp arguments for single videos and bounded playlists.

use std::{ffi::OsString, path::Path};

use crate::domain::{
    download::{CookiePreferences, DownloadConflictStrategy, DownloadOptions, MAX_PLAYLIST_ITEMS},
    error::{AppError, ErrorCode},
};

const DOWNLOAD_PROGRESS_TEMPLATE: &str = concat!(
    "download:SB_PROGRESS:{\"downloadedBytes\":\"%(progress.downloaded_bytes)s\",",
    "\"totalBytes\":\"%(progress.total_bytes)s\",",
    "\"totalBytesEstimate\":\"%(progress.total_bytes_estimate)s\",",
    "\"speed\":\"%(progress.speed)s\",\"eta\":\"%(progress.eta)s\"}"
);

const SINGLE_OUTPUT_TEMPLATE: &str = "%(title)s%(id& [{}]|)s.%(ext)s";
// Project only per-stream naming metadata, never media URLs or authentication headers.
const INTERMEDIATE_TEMPLATE: &str = concat!(
    "after_move:SB_PARTS:{\"output\":%(filepath)j,\"streams\":",
    "%(requested_formats.:.{filepath,format_id,ext,vcodec,acodec,width,height,resolution,tbr,vbr,abr}|null)j}"
);
const SERIES_OUTPUT_TEMPLATE: &str = "%(playlist_title,series,playlist|未命名系列)s%(playlist_id,series_id& [{}]|)s/%(playlist_index,episode_number|1)d-%(title)s%(id& [{}]|)s.%(ext)s";

/// Builds fixed, shell-free argv for a download task.
pub fn build_download_args(
    options: &DownloadOptions,
    cookies: &CookiePreferences,
) -> Result<Vec<OsString>, AppError> {
    validate_url(&options.url)?;
    if !matches!(
        options.format_id.as_str(),
        "bestaudio/best" | "bestvideo+bestaudio/best"
    ) {
        validate_format_selector(&options.format_id)?;
    }
    validate_subtitle_languages(&options.subtitle_languages)?;
    if options.write_automatic_subtitles && options.subtitle_languages.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "选择自动字幕前，请先指定至少一种字幕语言。",
            false,
        ));
    }
    let cookie_source_selected =
        cookies.cookies_file_path.is_some() || cookies.cookies_browser.is_some();
    if cookies.cookies_file_path.is_some() && cookies.cookies_browser.is_some() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "每个任务只能选择一种登录 Cookie 来源。",
            false,
        ));
    }
    if cookie_source_selected && !cookies.access_confirmed {
        return Err(AppError::new(
            ErrorCode::PermissionDenied,
            "使用登录 Cookie 前需要明确确认授权。",
            false,
        ));
    }
    let playlist_arguments = match options.playlist_item_count {
        Some(count) if (1..=MAX_PLAYLIST_ITEMS).contains(&count) => vec![
            OsString::from("--yes-playlist"),
            OsString::from("--no-write-playlist-metafiles"),
            OsString::from("--playlist-items"),
            OsString::from(format!("1-{count}")),
        ],
        Some(_) => {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "播放列表下载数量超出安全上限。",
                false,
            ));
        }
        None => vec![OsString::from("--no-playlist")],
    };

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

    let conflict_arg = match options.conflict_strategy {
        DownloadConflictStrategy::Skip => "--no-overwrites",
        DownloadConflictStrategy::Overwrite => "--force-overwrites",
    };
    let args = vec![
        "--ignore-config".into(),
        "--no-warnings".into(),
        "--windows-filenames".into(),
        conflict_arg.into(),
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
        if options.playlist_item_count.is_some() {
            SERIES_OUTPUT_TEMPLATE.into()
        } else {
            SINGLE_OUTPUT_TEMPLATE.into()
        },
        "--print".into(),
        "after_move:SB_RESULT:%(filepath)j".into(),
        "--".into(),
        options.url.clone().into(),
    ];
    let mut args = args;
    if options.keep_intermediate_files {
        args.splice(
            2..2,
            [
                "--keep-video".into(),
                "--print".into(),
                INTERMEDIATE_TEMPLATE.into(),
            ],
        );
    }
    args.splice(2..2, playlist_arguments);
    if !options.audio_only
        && let Some(container) = options.merge_container
    {
        args.splice(
            2..2,
            [
                OsString::from("--merge-output-format"),
                OsString::from(container.extension()),
            ],
        );
    }

    if let Some(path) = &cookies.cookies_file_path {
        validate_cookies_file(path)?;
        args.splice(
            args.len() - 2..args.len() - 2,
            [OsString::from("--cookies"), OsString::from(path)],
        );
    }
    if let Some(browser) = cookies.cookies_browser {
        args.splice(
            args.len() - 2..args.len() - 2,
            [
                OsString::from("--cookies-from-browser"),
                OsString::from(browser.yt_dlp_name()),
            ],
        );
    }

    if !options.subtitle_languages.is_empty() {
        args.splice(
            2..2,
            [
                OsString::from("--write-subs"),
                OsString::from("--sub-langs"),
            ],
        );
        args.insert(4, options.subtitle_languages.join(",").into());
    }
    if options.write_automatic_subtitles {
        args.splice(2..2, [OsString::from("--write-auto-subs")]);
    }
    if options.write_thumbnail {
        args.splice(2..2, [OsString::from("--write-thumbnail")]);
    }
    if options.write_info_json {
        args.splice(2..2, [OsString::from("--write-info-json")]);
    }
    if options.embed_metadata {
        args.splice(2..2, [OsString::from("--embed-metadata")]);
    }
    if options.audio_only {
        args.splice(
            2..2,
            [
                OsString::from("--extract-audio"),
                OsString::from("--audio-format"),
                OsString::from("mp3"),
            ],
        );
    }
    Ok(args)
}

fn validate_cookies_file(path: &str) -> Result<(), AppError> {
    let file_path = Path::new(path);
    if path.contains('\0')
        || file_path
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("txt")
        || !file_path.is_file()
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "请选择一个存在且可访问的 .txt Cookie 文件。",
            false,
        ));
    }
    Ok(())
}

fn validate_subtitle_languages(languages: &[String]) -> Result<(), AppError> {
    let valid = languages.len() <= 10
        && languages.iter().all(|language| {
            !language.is_empty()
                && language.len() <= 64
                && language
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidPath,
            "字幕语言选项无效，请重新解析并选择可用语言。",
            false,
        ))
    }
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

    use crate::domain::download::{CookiePreferences, DownloadOptions};

    use super::{
        DOWNLOAD_PROGRESS_TEMPLATE, SERIES_OUTPUT_TEMPLATE, SINGLE_OUTPUT_TEMPLATE,
        build_download_args,
    };

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
            title: "Example".into(),
            url: "https://example.com/watch?v=a&b=c".into(),
            format_id: "bestvideo+bestaudio".into(),
            merge_container: None,
            output_directory: directory.to_string_lossy().into_owned(),
            subtitle_languages: Vec::new(),
            conflict_strategy: crate::domain::download::DownloadConflictStrategy::Skip,
            playlist_item_count: None,
            audio_only: false,
            write_automatic_subtitles: false,
            write_thumbnail: false,
            write_info_json: false,
            embed_metadata: false,
            keep_intermediate_files: false,
            cookies_file_path: None,
            cookies_browser: None,
            cookie_access_confirmed: false,
        }
    }

    #[test]
    fn builds_fixed_argv_and_keeps_urls_and_paths_as_single_values() {
        let directory = temp_directory();
        let args = build_download_args(&options(&directory), &CookiePreferences::default())
            .expect("valid options should build");
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();

        assert!(strings.contains(&"--ignore-config".into()));
        assert!(!strings.contains(&"--keep-video".into()));
        assert!(!strings.iter().any(|value| value.contains("SB_PARTS:")));
        assert!(strings.contains(&"--no-playlist".into()));
        assert!(strings.contains(&"--no-overwrites".into()));
        assert!(strings.contains(&"--windows-filenames".into()));
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--output", SINGLE_OUTPUT_TEMPLATE])
        );
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
    fn retains_sources_only_when_explicitly_selected_without_changing_final_names() {
        let directory = temp_directory();
        let mut options = options(&directory);
        options.keep_intermediate_files = true;
        for audio_only in [false, true] {
            options.audio_only = audio_only;
            let args = build_download_args(&options, &CookiePreferences::default()).unwrap();
            assert!(args.contains(&"--keep-video".into()));
            assert!(
                args.windows(2)
                    .any(|pair| pair == ["--print", super::INTERMEDIATE_TEMPLATE])
            );
            assert!(
                args.windows(2)
                    .any(|pair| pair == ["--output", SINGLE_OUTPUT_TEMPLATE])
            );
        }
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_selector_syntax_that_could_enable_unintended_options() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.format_id = "best;--exec=touch /tmp/pwned".into();
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_err());
        download_options.audio_only = true;
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn preserves_selected_audio_and_the_predicted_merge_container() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.format_id = "137+140".into();
        download_options.merge_container = Some(crate::domain::download::MergeContainer::Mp4);
        let args = build_download_args(&download_options, &CookiePreferences::default()).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--format", "137+140"]));
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--merge-output-format", "mp4"])
        );

        download_options.audio_only = true;
        download_options.format_id = "251".into();
        download_options.merge_container = None;
        let args = build_download_args(&download_options, &CookiePreferences::default()).unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--format", "251"]));
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--audio-format", "mp3"])
        );
        assert!(!args.iter().any(|arg| arg == "--merge-output-format"));

        download_options.audio_only = false;
        download_options.playlist_item_count = Some(2);
        download_options.format_id = "bestvideo+bestaudio/best".into();
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_ok());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn selects_only_the_explicit_conflict_policy_flag() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.conflict_strategy =
            crate::domain::download::DownloadConflictStrategy::Overwrite;
        let args = build_download_args(&download_options, &CookiePreferences::default()).unwrap();
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();
        assert!(strings.contains(&"--force-overwrites".into()));
        assert!(!strings.contains(&"--no-overwrites".into()));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn playlist_download_is_explicit_and_limited_to_confirmed_item_count() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.playlist_item_count = Some(50);
        let args = build_download_args(&download_options, &CookiePreferences::default()).unwrap();
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();
        assert!(strings.contains(&"--yes-playlist".into()));
        assert!(strings.contains(&"--playlist-items".into()));
        assert!(strings.contains(&"1-50".into()));
        assert!(strings.contains(&"--no-write-playlist-metafiles".into()));
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--output", SERIES_OUTPUT_TEMPLATE])
        );
        assert!(!strings.contains(&"--no-playlist".into()));

        download_options.playlist_item_count = Some(51);
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn builds_audio_subtitle_thumbnail_and_metadata_options_without_shell_parsing() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.audio_only = true;
        download_options.format_id = "bestaudio/best".into();
        download_options.subtitle_languages = vec!["en-US".into(), "zh-Hans".into()];
        download_options.write_automatic_subtitles = true;
        download_options.write_thumbnail = true;
        download_options.write_info_json = true;
        download_options.embed_metadata = true;

        let args = build_download_args(&download_options, &CookiePreferences::default()).unwrap();
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();
        for flag in [
            "--extract-audio",
            "--audio-format",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs",
            "--write-thumbnail",
            "--write-info-json",
            "--embed-metadata",
        ] {
            assert!(strings.contains(&flag.into()), "missing {flag}");
        }
        assert!(strings.contains(&"bestaudio/best".into()));
        assert!(strings.contains(&"mp3".into()));
        assert!(strings.contains(&"en-US,zh-Hans".into()));

        download_options.subtitle_languages = vec!["en,all".into()];
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_err());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn requires_cookie_consent_and_supports_only_one_cookie_source() {
        let directory = temp_directory();
        let cookie_file = directory.join("cookies.txt");
        fs::write(&cookie_file, "not read by Savebeam").unwrap();
        let download_options = options(&directory);
        let mut cookies = CookiePreferences {
            cookies_file_path: Some(cookie_file.to_string_lossy().into_owned()),
            ..CookiePreferences::default()
        };
        assert!(build_download_args(&download_options, &cookies).is_err());

        cookies.access_confirmed = true;
        let args = build_download_args(&download_options, &cookies).unwrap();
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();
        assert!(strings.contains(&"--cookies".into()));
        assert!(strings.contains(&cookie_file.to_string_lossy().into_owned().into()));

        cookies.cookies_browser = Some(crate::domain::download::CookieBrowser::Firefox);
        assert!(build_download_args(&download_options, &cookies).is_err());
        cookies.cookies_file_path = None;
        let args = build_download_args(&download_options, &cookies).unwrap();
        let strings: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();
        assert!(strings.contains(&"--cookies-from-browser".into()));
        assert!(strings.contains(&"firefox".into()));

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn rejects_missing_output_directory_and_non_http_url() {
        let directory = temp_directory();
        let mut download_options = options(&directory);
        download_options.output_directory =
            directory.join("missing").to_string_lossy().into_owned();
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_err());
        download_options.output_directory = directory.to_string_lossy().into_owned();
        download_options.url = "file:///etc/passwd".into();
        assert!(build_download_args(&download_options, &CookiePreferences::default()).is_err());
        let _ = fs::remove_dir_all(directory);
    }
}
