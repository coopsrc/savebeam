use crate::{
    domain::{
        download::{DownloadHistoryRecord, DownloadOptions, DownloadTaskStatus},
        error::{AppError, ErrorCode},
        source_version::{MediaVersion, VersionFile},
    },
    infrastructure::database::{
        Database,
        repositories::{DownloadTaskRepository, HistoryRepository},
        versions::VersionRepository,
    },
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn history_options(
    database: &Database,
    id: &str,
) -> Result<(DownloadHistoryRecord, DownloadOptions), AppError> {
    if id.len() > 128 {
        return Err(invalid("任务标识无效。"));
    }
    let (task, options) = DownloadTaskRepository::new(database.clone())
        .get(id)?
        .ok_or_else(|| invalid("任务不存在。"))?;
    let record = HistoryRepository::new(database.clone())
        .get(id)?
        .ok_or_else(|| invalid("下载历史已删除，无法定位版本。"))?;
    if task.status != DownloadTaskStatus::Completed {
        return Err(invalid("只有已完成的任务可以检查来源或创建版本。"));
    }
    Ok((record, options))
}

pub fn ensure_baseline(database: &Database, id: &str) -> Result<MediaVersion, AppError> {
    let (record, options) = history_options(database, id)?;
    let repository = VersionRepository(database.clone());
    if let Some(version) = repository.get(id)? {
        return Ok(version);
    }
    // Legacy downloads: capture current local bytes only, never invent a historic source baseline.
    repository.save(
        id,
        None,
        &hash_files(&record.output_paths, Path::new(&options.output_directory)),
        record.completed_at_unix_ms,
    )?;
    repository
        .get(id)?
        .ok_or_else(|| invalid("版本记录保存失败。"))
}

pub fn hash_files(paths: &[String], output_directory: &Path) -> Vec<VersionFile> {
    hash_files_cancellable(paths, output_directory, None)
}

pub fn hash_files_cancellable(
    paths: &[String],
    output_directory: &Path,
    cancel: Option<&crate::infrastructure::ytdlp_process::CancellationToken>,
) -> Vec<VersionFile> {
    let root = output_directory.canonicalize().ok();
    paths
        .iter()
        .take(50)
        .map(|path| {
            let mut result = VersionFile {
                path: path.clone(),
                size_bytes: None,
                sha256: None,
            };
            let digest = (|| -> Option<(u64, String)> {
                let metadata = fs::symlink_metadata(path).ok()?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return None;
                }
                let canonical = Path::new(path).canonicalize().ok()?;
                if !canonical.starts_with(root.as_ref()?) {
                    return None;
                }
                let mut open = OpenOptions::new();
                open.read(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    open.custom_flags(libc::O_NOFOLLOW);
                }
                let mut file = open.open(&canonical).ok()?;
                let before = file.metadata().ok()?;
                if !before.is_file() {
                    return None;
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if before.dev() != metadata.dev() || before.ino() != metadata.ino() {
                        return None;
                    }
                }
                let mut hash = Sha256::new();
                let mut buffer = [0; 64 * 1024];
                loop {
                    if cancel.is_some_and(|c| c.is_cancelled()) {
                        return None;
                    }
                    let count = file.read(&mut buffer).ok()?;
                    if count == 0 {
                        break;
                    }
                    hash.update(&buffer[..count]);
                }
                let after = file.metadata().ok()?;
                if before.len() != after.len()
                    || before.modified().ok()? != after.modified().ok()?
                    || Path::new(path).canonicalize().ok()? != canonical
                {
                    return None;
                }
                Some((after.len(), hex::encode(hash.finalize())))
            })();
            if let Some((size, hash)) = digest {
                result.size_bytes = Some(size);
                result.sha256 = Some(hash);
            }
            result
        })
        .collect()
}

pub fn version_directory(database: &Database, parent: &str) -> Result<PathBuf, AppError> {
    let root_id = VersionRepository(database.clone()).root(parent)?;
    if root_id.is_empty()
        || root_id.len() > 128
        || !root_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return Err(invalid("根任务标识无效。"));
    }
    let (_, options) = DownloadTaskRepository::new(database.clone())
        .get(&root_id)?
        .ok_or_else(|| invalid("原下载任务不存在。"))?;
    let root = Path::new(&options.output_directory)
        .canonicalize()
        .map_err(|_| invalid("原下载目录不可访问，请恢复目录后重试。"))?;
    let mut directory = root.clone();
    for component in ["Savebeam Versions", &root_id] {
        directory.push(component);
        match fs::create_dir(&directory) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
            Err(_) => return Err(invalid("无法创建版本目录。")),
        }
        let metadata =
            fs::symlink_metadata(&directory).map_err(|_| invalid("无法验证版本目录。"))?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || !directory
                .canonicalize()
                .map_err(|_| invalid("版本目录不可访问。"))?
                .starts_with(&root)
        {
            return Err(invalid("版本目录不可为符号链接或越过下载目录。"));
        }
    }
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid("系统时间不可用。"))?
        .as_nanos();
    directory.push(format!(
        "v-{timestamp}-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&directory).map_err(|_| invalid("无法保留新的版本目录，请重试。"))?;
    Ok(directory)
}

pub fn invalid(message: &str) -> AppError {
    AppError::new(ErrorCode::InvalidPath, message, false)
}

/// Preserve task options, but re-match current formats instead of stale format IDs.
pub fn prepare_version_options(
    mut options: DownloadOptions,
    parent: &str,
    proxy: bool,
    current: &crate::domain::source_version::SourceObservation,
    title: String,
    item: &serde_json::Value,
) -> Result<DownloadOptions, AppError> {
    options.group = super::download_groups::infer(&options);
    let media = crate::services::media_mapper::map_media_info(item, &options.url)?;
    let details = crate::services::playlist_quality::PlaylistDetails {
        preview: None,
        part: None,
        parts: Vec::new(),
        index: options
            .playlist_items
            .as_ref()
            .and_then(|i| i.first())
            .copied()
            .unwrap_or(1),
        id: Some(current.media_id.clone()),
        title: Some(title.clone()),
        duration_seconds: media.duration_seconds,
        formats: media.formats,
        subtitles: media.subtitles,
        error: None,
    };
    let policy = options.quality_policy.clone().unwrap_or(
        crate::domain::playlist_quality::PlaylistQuality {
            automatic_recommendations: true,
            ..Default::default()
        },
    );
    let matched = crate::services::playlist_quality::select(&details, &policy, options.audio_only);
    options.format_id = matched
        .format_id
        .ok_or_else(|| invalid("当前来源无匹配格式，请重新解析并调整画质。"))?;
    options.merge_container = matched.merge_container;
    options.title = title;
    options.expected_media_id = Some(current.media_id.clone());
    options.quality_policy = Some(policy);
    options.version_parent_task_id = Some(parent.into());
    options.use_proxy = Some(proxy);
    options.cookies_file_path = None;
    options.cookies_browser = None;
    options.cookie_access_confirmed = false;
    options.conflict_strategy = crate::domain::download::DownloadConflictStrategy::Skip;
    Ok(options)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::download::{DownloadConflictStrategy, DownloadResult, DownloadTask};
    use crate::domain::source_version::SourceObservation;
    use serde_json::json;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "savebeam-versions-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn database(&self) -> Database {
            Database::open(self.0.join("versions.sqlite3")).unwrap()
        }
        fn options(&self) -> DownloadOptions {
            DownloadOptions {
                title: "视频".into(),
                url: "https://example.com/watch/v".into(),
                format_id: "old-video+old-audio".into(),
                output_directory: self.0.to_string_lossy().into(),
                ..Default::default()
            }
        }
        fn task(&self, db: &Database, id: &str, options: &DownloadOptions) {
            DownloadTaskRepository::new(db.clone())
                .insert(
                    &DownloadTask {
                        group: None,
                        id: id.into(),
                        title: options.title.clone(),
                        url: options.url.clone(),
                        format_id: options.format_id.clone(),
                        status: DownloadTaskStatus::Completed,
                        created_at_unix_ms: 1,
                    },
                    options,
                )
                .unwrap();
            HistoryRepository::new(db.clone())
                .insert(
                    &DownloadResult {
                        task_id: id.into(),
                        title: options.title.clone(),
                        output_paths: vec![
                            self.0.join(format!("{id}.mp4")).to_string_lossy().into(),
                        ],
                        total_bytes: 3,
                    },
                    2,
                )
                .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn legacy_baseline_hashes_existing_local_bytes_without_inventing_remote_evidence() {
        let f = Fixture::new();
        let db = f.database();
        f.task(&db, "root", &f.options());
        fs::write(f.0.join("root.mp4"), b"abc").unwrap();
        let first = ensure_baseline(&db, "root").unwrap();
        assert!(first.source.is_none());
        assert_eq!(
            first.files[0].sha256.as_deref(),
            Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        );
        assert_eq!(first.files[0].size_bytes, Some(3));
        fs::write(f.0.join("root.mp4"), b"changed").unwrap();
        assert_eq!(
            ensure_baseline(&db, "root").unwrap().files[0].sha256,
            first.files[0].sha256
        );
        assert!(history_options(&db, "missing").is_err());
    }

    #[test]
    fn hashes_reject_missing_outside_and_symlink_files_and_respect_cancellation() {
        let f = Fixture::new();
        let outside = Fixture::new();
        fs::write(outside.0.join("outside.mp4"), b"outside").unwrap();
        fs::write(f.0.join("inside.mp4"), b"abc").unwrap();
        let paths = vec![
            f.0.join("missing").to_string_lossy().into(),
            outside.0.join("outside.mp4").to_string_lossy().into(),
        ];
        assert!(hash_files(&paths, &f.0).iter().all(|v| v.sha256.is_none()));
        let token = crate::infrastructure::ytdlp_process::CancellationToken::default();
        token.cancel();
        assert!(
            hash_files_cancellable(
                &[f.0.join("inside.mp4").to_string_lossy().into()],
                &f.0,
                Some(&token)
            )[0]
            .sha256
            .is_none()
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(f.0.join("inside.mp4"), f.0.join("link.mp4")).unwrap();
            assert!(
                hash_files(&[f.0.join("link.mp4").to_string_lossy().into()], &f.0)[0]
                    .sha256
                    .is_none()
            );
        }
    }

    #[test]
    fn independent_version_directories_preserve_old_files_and_root_lineage_after_reopen() {
        let f = Fixture::new();
        let db = f.database();
        f.task(&db, "root", &f.options());
        fs::write(f.0.join("root.mp4"), b"old").unwrap();
        let first = version_directory(&db, "root").unwrap();
        let mut options = f.options();
        options.version_parent_task_id = Some("root".into());
        options.output_directory = first.to_string_lossy().into();
        f.task(&db, "child", &options);
        let second = version_directory(&f.database(), "child").unwrap();
        assert_ne!(first, second);
        assert_eq!(first.parent(), second.parent());
        assert!(second.starts_with(f.0.canonicalize().unwrap().join("Savebeam Versions/root")));
        assert_eq!(fs::read(f.0.join("root.mp4")).unwrap(), b"old");
        #[cfg(unix)]
        {
            let g = Fixture::new();
            let other = g.database();
            g.task(&other, "root", &g.options());
            std::os::unix::fs::symlink(&f.0, g.0.join("Savebeam Versions")).unwrap();
            assert!(version_directory(&other, "root").is_err());
        }
    }

    #[test]
    fn version_repository_numbers_persists_and_deletes_only_requested_metadata() {
        let f = Fixture::new();
        let db = f.database();
        f.task(&db, "root", &f.options());
        let repo = VersionRepository(db.clone());
        let source = SourceObservation::from_raw(&json!({"id":"v","duration":10})).unwrap();
        repo.save("root", Some(&source), &[], 2).unwrap();
        let mut options = f.options();
        options.version_parent_task_id = Some("root".into());
        f.task(&db, "child", &options);
        repo.save("child", Some(&source), &[], 3).unwrap();
        repo.save("child", Some(&source), &[], 4).unwrap();
        let rows = VersionRepository(f.database()).list("child").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].version_number, 2);
        assert_eq!(rows[0].completed_at_unix_ms, 4);
        assert_eq!(rows[0].parent_task_id.as_deref(), Some("root"));
        assert_eq!(rows[1].source.as_ref(), Some(&source));
        HistoryRepository::new(db.clone()).delete("root").unwrap();
        assert!(repo.get("root").unwrap().is_none());
        assert_eq!(repo.list("child").unwrap().len(), 1);
        assert!(ensure_baseline(&db, "root").is_err());
        assert!(repo.save("child", None, &[], u64::MAX).is_err());
        db.with_connection(|c| {
            c.execute(
                "UPDATE download_tasks SET version_parent_task_id='child' WHERE task_id='root'",
                [],
            )
        })
        .unwrap();
        assert!(repo.root("child").is_err());
    }

    fn current() -> serde_json::Value {
        json!({"id":"v", "title":"新标题", "formats":[
            {"format_id":"new-video","ext":"mp4","height":1080,"width":1920,"fps":30,"vcodec":"hvc1","acodec":"none"},
            {"format_id":"new-audio","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","abr":128}
        ]})
    }

    #[test]
    fn new_versions_rematch_formats_and_keep_advanced_options_through_restart_and_retry() {
        let f = Fixture::new();
        let db = f.database();
        let mut original = f.options();
        original.subtitle_languages = vec!["en".into()];
        original.write_info_json = true;
        original.keep_intermediate_files = true;
        original.write_thumbnail = true;
        original.conflict_strategy = DownloadConflictStrategy::Overwrite;
        original.cookies_file_path = Some("/do/not/store/cookies".into());
        original.cookie_access_confirmed = true;
        original.playlist_item_count = Some(1);
        original.playlist_items = Some(vec![17]);
        f.task(&db, "root", &original);
        let raw = current();
        let source = SourceObservation::from_raw(&raw).unwrap();
        let mut options = prepare_version_options(
            original.clone(),
            "root",
            false,
            &source,
            "新标题".into(),
            &raw,
        )
        .unwrap();
        assert_eq!(options.format_id, "new-video+new-audio");
        assert_eq!(options.conflict_strategy, DownloadConflictStrategy::Skip);
        assert_eq!(options.subtitle_languages, original.subtitle_languages);
        assert!(
            options.write_info_json && options.keep_intermediate_files && options.write_thumbnail
        );
        assert!(options.cookies_file_path.is_none() && !options.cookie_access_confirmed);
        assert_eq!(options.playlist_items, Some(vec![17]));
        assert_eq!(options.use_proxy, Some(false));
        options.output_directory = version_directory(&db, "root")
            .unwrap()
            .to_string_lossy()
            .into();
        crate::commands::downloads::validate_task_options(&options).unwrap();
        crate::security::download_args::build_download_args_with_network(
            &options,
            &Default::default(),
            &Default::default(),
        )
        .unwrap();
        let registry = crate::services::download_registry::DownloadTaskRegistry::default();
        registry.initialize_from_database(db).unwrap();
        let task = registry.create(options.clone()).unwrap();
        let reopened = crate::services::download_registry::DownloadTaskRegistry::default();
        reopened.initialize_from_database(f.database()).unwrap();
        let (restored, saved) = reopened.claim_next().unwrap().unwrap();
        assert_eq!(restored.id, task.id);
        assert_eq!(saved, options);
        reopened
            .transition(&task.id, DownloadTaskStatus::Preparing)
            .unwrap();
        reopened
            .transition(&task.id, DownloadTaskStatus::Failed)
            .unwrap();
        assert_eq!(reopened.retry(&task.id).unwrap().1, options);
        assert_eq!(
            VersionRepository(f.database()).root(&task.id).unwrap(),
            "root"
        );
        assert!(
            DownloadTaskRepository::new(f.database())
                .get("root")
                .unwrap()
                .unwrap()
                .1
                .version_parent_task_id
                .is_none()
        );
    }

    #[test]
    fn single_media_versions_can_pin_identity_and_strict_policies_never_silently_fallback() {
        let f = Fixture::new();
        let raw = current();
        let source = SourceObservation::from_raw(&raw).unwrap();
        let opts =
            prepare_version_options(f.options(), "root", true, &source, "新标题".into(), &raw)
                .unwrap();
        crate::security::download_args::build_download_args_with_network(
            &opts,
            &Default::default(),
            &crate::domain::network::NetworkPreferences {
                proxy_mode: crate::domain::network::ProxyMode::Custom,
                proxy_url: "http://127.0.0.1:7890".into(),
            },
        )
        .unwrap();
        assert_eq!(opts.use_proxy, Some(true));
        let mut original = f.options();
        original.quality_policy = Some(crate::domain::playlist_quality::PlaylistQuality {
            resolution_height: Some(2160),
            ..Default::default()
        });
        assert!(
            prepare_version_options(original, "root", false, &source, "新标题".into(), &raw)
                .is_err()
        );
    }
}
