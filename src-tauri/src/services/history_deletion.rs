//! Opt-in trashing of exact history outputs, never a directory scan or permanent delete.

use std::{
    collections::HashSet,
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

use crate::{
    domain::{
        download::DownloadTaskStatus,
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{
        Database,
        repositories::{DownloadTaskRepository, HistoryRepository},
    },
};

pub fn delete_history_entry(
    database: &Database,
    task_id: &str,
    delete_files: bool,
) -> Result<bool, AppError> {
    delete_history_with(database, task_id, delete_files, move_to_trash)
}

fn move_to_trash(path: &Path) -> Result<(), AppError> {
    let context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    let context = {
        let mut context = context;
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        // Native API avoids Finder automation permissions. Files remain recoverable
        // by dragging them out of Trash even when Finder does not offer Put Back.
        context.set_delete_method(DeleteMethod::NsFileManager);
        context
    };
    // No remove_file fallback: unavailable trash must fail and preserve history.
    context.delete(path).map_err(|error| {
        AppError::new(
            ErrorCode::PermissionDenied,
            "无法将下载文件移入系统废纸篓；历史记录已保留。",
            true,
        )
        .with_diagnostic(error.to_string())
    })
}

fn delete_history_with(
    database: &Database,
    task_id: &str,
    delete_files: bool,
    mut move_file: impl FnMut(&Path) -> Result<(), AppError>,
) -> Result<bool, AppError> {
    let history = HistoryRepository::new(database.clone());
    if !delete_files {
        return history.delete(task_id);
    }
    let Some(record) = history.get(task_id)? else {
        return Ok(false);
    };
    let (task, options) = DownloadTaskRepository::new(database.clone())
        .get(task_id)?
        .ok_or_else(|| invalid_output("找不到对应的下载任务，已拒绝删除文件。"))?;
    if task.status != DownloadTaskStatus::Completed {
        return Err(invalid_output("关联任务尚未完成，已拒绝删除下载文件。"));
    }
    let mut unique = HashSet::new();
    let mut existing = Vec::new();
    // Preflight every path before moving any file. Missing files are idempotent.
    for value in record.output_paths {
        let path = PathBuf::from(value);
        if !path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err(invalid_output("下载记录包含不安全的文件路径，已拒绝删除。"));
        }
        if unique.insert(path.clone()) && is_regular_file(&path)? {
            existing.push(path);
        }
    }
    if !existing.is_empty() {
        let root = Path::new(&options.output_directory)
            .canonicalize()
            .map_err(|_| invalid_output("原下载目录不可访问，已拒绝删除文件。"))?;
        for path in &existing {
            validate_location(path, &root)?;
        }
        for path in existing {
            // Recheck after preflight; never hand directories/symlinks to trash.
            if is_regular_file(&path)? {
                validate_location(&path, &root)?;
                move_file(&path)?;
            }
        }
    }
    // On any file error above, retain the row for retry and show a partial-failure
    // warning. Retrying skips files already moved; never purge the OS trash.
    history.delete(task_id)
}

fn is_regular_file(path: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err(invalid_output(
            "记录中的文件已变成目录或符号链接，已拒绝删除。",
        )),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(_) => Err(invalid_output("无法检查下载文件，已拒绝删除。")),
    }
}

fn validate_location(path: &Path, root: &Path) -> Result<(), AppError> {
    let canonical = path
        .canonicalize()
        .map_err(|_| invalid_output("下载文件路径不可访问。"))?;
    // Stored final paths are canonicalized by download_verifier. Reject changed
    // ancestor symlinks, escapes, or a root directory masquerading as an output.
    if canonical != path || !canonical.starts_with(root) || canonical == root {
        return Err(invalid_output(
            "下载文件位置已改变或超出原下载目录，已拒绝删除。",
        ));
    }
    Ok(())
}

fn invalid_output(message: &str) -> AppError {
    AppError::new(ErrorCode::PermissionDenied, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::download::{
        DownloadOptions, DownloadResult, DownloadTask, DownloadTaskStatus,
    };

    struct Fixture {
        root: PathBuf,
        download: PathBuf,
        database: Database,
        paths: Vec<PathBuf>,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "savebeam-history-delete-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(root.join("download/series")).unwrap();
            fs::create_dir(root.join("trash-fixture")).unwrap();
            let root = root.canonicalize().unwrap();
            let download = root.join("download");
            let paths = vec![
                download.join("series/1-first [id1].mp4"),
                download.join("series/2-second [id2].mp4"),
            ];
            for path in &paths {
                fs::write(path, b"synthetic media").unwrap();
            }
            fs::write(download.join("series/1-first [id1].info.json"), b"sidecar").unwrap();
            fs::write(download.join("series/retained-video-f1.mp4"), b"retained").unwrap();
            let database = Database::open_in_memory().unwrap();
            let options = DownloadOptions {
                title: "Fixture".into(),
                url: "https://example.com/video".into(),
                format_id: "18".into(),
                output_directory: download.to_string_lossy().into_owned(),
                ..Default::default()
            };
            DownloadTaskRepository::new(database.clone())
                .insert(
                    &DownloadTask {
                        group: None,
                        batch_id: None,
                        id: "history-1".into(),
                        title: options.title.clone(),
                        url: options.url.clone(),
                        format_id: options.format_id.clone(),
                        status: DownloadTaskStatus::Completed,
                        created_at_unix_ms: 1,
                    },
                    &options,
                )
                .unwrap();
            let fixture = Self {
                root,
                download,
                database,
                paths,
            };
            fixture.record(&fixture.paths);
            fixture
        }

        fn record(&self, paths: &[PathBuf]) {
            HistoryRepository::new(self.database.clone())
                .insert(
                    &DownloadResult {
                        task_id: "history-1".into(),
                        title: "Fixture".into(),
                        output_paths: paths
                            .iter()
                            .map(|path| path.to_string_lossy().into_owned())
                            .collect(),
                        total_bytes: 30,
                    },
                    2,
                )
                .unwrap();
        }

        fn has_history(&self) -> bool {
            HistoryRepository::new(self.database.clone())
                .get("history-1")
                .unwrap()
                .is_some()
        }

        fn fake_trash(&self, path: &Path) -> Result<(), AppError> {
            fs::rename(
                path,
                self.root
                    .join("trash-fixture")
                    .join(path.file_name().unwrap()),
            )
            .map_err(|_| invalid_output("Fixture move failed"))
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn record_only_deletion_never_touches_files_or_task() {
        let fixture = Fixture::new();
        assert!(
            delete_history_with(&fixture.database, "history-1", false, |_| panic!(
                "must not touch files"
            ))
            .unwrap()
        );
        assert!(!fixture.has_history());
        assert!(fixture.paths.iter().all(|path| path.exists()));
        assert!(
            DownloadTaskRepository::new(fixture.database.clone())
                .get("history-1")
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn trashes_only_exact_existing_files_deduplicates_and_keeps_sidecars_and_directories() {
        let fixture = Fixture::new();
        fixture.record(&[
            fixture.paths[0].clone(),
            fixture.paths[0].clone(),
            fixture.paths[1].clone(),
            fixture.download.join("missing.mp4"),
        ]);
        let mut moved = 0;
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |path| {
                moved += 1;
                fixture.fake_trash(path)
            })
            .unwrap()
        );
        assert_eq!(moved, 2);
        assert!(!fixture.has_history());
        assert!(fixture.paths.iter().all(|path| !path.exists()));
        assert!(
            fixture
                .download
                .join("series/1-first [id1].info.json")
                .exists()
        );
        assert!(
            fixture
                .download
                .join("series/retained-video-f1.mp4")
                .exists()
        );
        assert!(fixture.download.join("series").is_dir());
        assert_eq!(
            fs::read(fixture.root.join("trash-fixture/1-first [id1].mp4")).unwrap(),
            b"synthetic media"
        );
    }

    #[test]
    fn failure_keeps_history_and_never_falls_back_to_permanent_removal() {
        let fixture = Fixture::new();
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |_| Err(
                invalid_output("trash unavailable")
            ))
            .is_err()
        );
        assert!(fixture.has_history());
        assert!(fixture.paths.iter().all(|path| path.exists()));
    }

    #[test]
    fn partial_failure_retains_history_and_retry_skips_already_moved_files() {
        let fixture = Fixture::new();
        let mut moved = 0;
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |path| {
                moved += 1;
                if moved == 2 {
                    return Err(invalid_output("fixture failure"));
                }
                fixture.fake_trash(path)
            })
            .is_err()
        );
        assert!(fixture.has_history());
        assert!(!fixture.paths[0].exists());
        assert!(fixture.paths[1].exists());
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |path| fixture
                .fake_trash(path))
            .unwrap()
        );
        assert!(!fixture.has_history());
        assert!(
            fixture
                .root
                .join("trash-fixture/1-first [id1].mp4")
                .exists()
        );
        assert!(
            fixture
                .root
                .join("trash-fixture/2-second [id2].mp4")
                .exists()
        );
    }

    #[test]
    fn preflight_rejects_directories_relative_paths_and_escapes_before_any_file_is_moved() {
        let fixture = Fixture::new();
        let outside = fixture.root.join("outside.mp4");
        fs::write(&outside, b"outside").unwrap();
        for unsafe_path in [
            fixture.download.join("series"),
            outside.clone(),
            PathBuf::from("relative.mp4"),
            fixture.download.join("../outside.mp4"),
        ] {
            fixture.record(&[fixture.paths[0].clone(), unsafe_path]);
            assert!(
                delete_history_with(&fixture.database, "history-1", true, |_| panic!(
                    "preflight must reject all paths first"
                ))
                .is_err()
            );
            assert!(fixture.has_history());
            assert!(fixture.paths.iter().all(|path| path.exists()));
        }
        assert_eq!(fs::read(outside).unwrap(), b"outside");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_file_and_changed_ancestor_symlinks() {
        let fixture = Fixture::new();
        let link = fixture.download.join("linked.mp4");
        std::os::unix::fs::symlink(&fixture.paths[0], &link).unwrap();
        let ancestor = fixture.download.join("alias");
        std::os::unix::fs::symlink(fixture.download.join("series"), &ancestor).unwrap();
        for path in [link, ancestor.join("1-first [id1].mp4")] {
            fixture.record(&[fixture.paths[1].clone(), path]);
            assert!(
                delete_history_with(&fixture.database, "history-1", true, |_| panic!(
                    "must reject links"
                ))
                .is_err()
            );
            assert!(fixture.has_history());
            assert!(fixture.paths.iter().all(|path| path.exists()));
        }
    }

    #[test]
    fn refuses_to_trash_outputs_of_an_active_task() {
        let fixture = Fixture::new();
        DownloadTaskRepository::new(fixture.database.clone())
            .update_status("history-1", DownloadTaskStatus::Downloading, 3)
            .unwrap();
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |_| panic!(
                "active task must not lose files"
            ))
            .is_err()
        );
        assert!(fixture.has_history());
        assert!(fixture.paths.iter().all(|path| path.exists()));
    }

    #[test]
    fn already_missing_outputs_do_not_require_the_old_download_directory_to_exist() {
        let fixture = Fixture::new();
        let missing_root = fixture.root.join("no-longer-existing");
        fixture.record(&[missing_root.join("missing.mp4")]);
        fixture
            .database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE download_tasks SET output_directory = ?1 WHERE task_id = 'history-1'",
                    [missing_root.to_string_lossy().as_ref()],
                )
            })
            .unwrap();
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |_| panic!(
                "missing output must not be moved"
            ))
            .unwrap()
        );
        assert!(!fixture.has_history());
        assert!(fixture.paths.iter().all(|path| path.exists()));
    }

    #[test]
    fn missing_files_and_missing_records_are_idempotent() {
        let fixture = Fixture::new();
        fixture.record(&[fixture.download.join("missing.mp4")]);
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |_| panic!(
                "missing file must not be moved"
            ))
            .unwrap()
        );
        assert!(
            !delete_history_with(&fixture.database, "history-1", true, |_| panic!(
                "missing record must not touch files"
            ))
            .unwrap()
        );
        assert!(
            !delete_history_with(&fixture.database, "unknown-task", false, |_| panic!(
                "unknown record must not touch files"
            ))
            .unwrap()
        );
        assert!(fixture.paths.iter().all(|path| path.exists()));
    }

    #[cfg(unix)]
    #[test]
    fn rechecks_paths_after_preflight_before_each_move() {
        let fixture = Fixture::new();
        let outside = fixture.root.join("outside.mp4");
        fs::write(&outside, b"outside").unwrap();
        let mut moved = 0;
        assert!(
            delete_history_with(&fixture.database, "history-1", true, |path| {
                moved += 1;
                fixture.fake_trash(path)?;
                fs::remove_file(&fixture.paths[1]).unwrap();
                std::os::unix::fs::symlink(&outside, &fixture.paths[1]).unwrap();
                Ok(())
            })
            .is_err()
        );
        assert_eq!(moved, 1);
        assert!(fixture.has_history());
        assert_eq!(fs::read(outside).unwrap(), b"outside");
    }
}
