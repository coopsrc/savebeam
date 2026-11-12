//! Local filesystem truth for startup recovery; never scan folders or delete files.
use crate::{
    domain::{
        download::{DownloadOptions, DownloadTask, DownloadTaskStatus},
        error::AppError,
    },
    infrastructure::database::{
        Database,
        repositories::{DownloadTaskRepository, HistoryRepository},
    },
};
use std::{
    collections::{HashMap, HashSet},
    io::ErrorKind,
    path::{Component, Path},
};

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilePresence {
    pub state: String,
    pub missing_count: usize,
    pub total_count: usize,
}

pub fn files(database: &Database, task_id: &str) -> Result<FilePresence, AppError> {
    let record = HistoryRepository::new(database.clone()).get(task_id)?;
    let options = DownloadTaskRepository::new(database.clone()).get(task_id)?;
    let (Some(record), Some((_, options))) = (record, options) else {
        return Ok(FilePresence {
            state: "unavailable".into(),
            missing_count: 0,
            total_count: 0,
        });
    };
    let total = record.output_paths.len();
    let mut missing = 0;
    let mut unavailable = total == 0;
    let mut bytes = 0_u64;
    let root = Path::new(&options.output_directory).canonicalize().ok();
    for value in &record.output_paths {
        let path = Path::new(value);
        if !path.is_absolute() || path.components().any(|p| matches!(p, Component::ParentDir)) {
            unavailable = true;
            continue;
        }
        match std::fs::symlink_metadata(path) {
            Err(e) if e.kind() == ErrorKind::NotFound => {
                missing += 1;
            }
            Err(_) => {
                unavailable = true;
            }
            Ok(meta) => {
                if let Some(sum) = bytes.checked_add(meta.len()) {
                    bytes = sum;
                } else {
                    unavailable = true;
                }
                if !meta.is_file()
                    || meta.len() == 0
                    || root
                        .as_ref()
                        .is_none_or(|r| !path.starts_with(r) || path == r)
                    || path.canonicalize().ok().as_deref() != Some(path)
                {
                    unavailable = true;
                }
            }
        }
    }
    if missing == 0 && record.total_bytes > 0 && bytes != record.total_bytes {
        unavailable = true;
    }
    Ok(FilePresence {
        state: if unavailable {
            "unavailable"
        } else if missing > 0 {
            "missing"
        } else {
            "present"
        }
        .into(),
        missing_count: missing,
        total_count: total,
    })
}

pub fn recover(
    database: &Database,
    records: &mut [(DownloadTask, DownloadOptions)],
) -> Result<(), AppError> {
    use DownloadTaskStatus::*;
    let repo = DownloadTaskRepository::new(database.clone());
    let mut legacy = HashMap::new();
    for (task, options) in records.iter_mut() {
        if task.status != Completed && task.batch_id.is_none() {
            let key = task
                .group
                .as_ref()
                .map_or_else(|| task.id.clone(), |g| g.key.clone());
            let batch = legacy
                .entry(key)
                .or_insert_with(super::download_groups::new_batch_id);
            let batch = repo.assign_recovery_batch(&task.id, batch)?;
            task.batch_id = Some(batch.clone());
            options.batch_id = Some(batch);
        }
    }
    // Failed/cancelled work stays manual. A completed round is never restarted.
    let resuming: HashSet<_> = records
        .iter()
        .filter(|(t, _)| matches!(t.status, Queued | Preparing | Downloading | PostProcessing))
        .filter_map(|(t, _)| t.batch_id.clone())
        .collect();
    let open: HashSet<_> = records
        .iter()
        .filter(|(t, _)| t.status != Completed)
        .filter_map(|(t, _)| t.batch_id.clone())
        .collect();
    for (task, options) in records.iter_mut() {
        let next = match task.status {
            Preparing | Downloading | PostProcessing => Queued,
            Cancelling => Cancelled,
            Completed if task.batch_id.as_ref().is_some_and(|b| open.contains(b)) => {
                let presence = files(database, &task.id)?;
                let resume = task.batch_id.as_ref().is_some_and(|b| resuming.contains(b));
                match presence.state.as_str() {
                    "present" => Completed,
                    "missing" => {
                        crate::infrastructure::database::subscriptions::SubscriptionRepository(
                            database.clone(),
                        )
                        .unmark_task_downloaded(options)?;
                        if resume { Queued } else { Failed }
                    }
                    _ if presence.total_count == 0 && resume => Queued,
                    _ => Failed,
                }
            }
            other => other,
        };
        if next != task.status {
            repo.update_status(&task.id, next, now())?;
            task.status = next;
        }
    }
    Ok(())
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |t| t.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::download::{DownloadGroupHint, DownloadGroupKind, DownloadResult};
    fn seed(
        db: &Database,
        root: &Path,
        id: &str,
        batch: Option<&str>,
        status: DownloadTaskStatus,
    ) -> DownloadOptions {
        let group = crate::services::download_groups::make(
            "https://example.com/list",
            Some(&DownloadGroupHint {
                title: "Series".into(),
                kind: DownloadGroupKind::Collection,
            }),
            Some(1),
            None,
        )
        .unwrap();
        let options = DownloadOptions {
            batch_id: batch.map(str::to_owned),
            group: Some(group.clone()),
            title: id.into(),
            url: "https://example.com/list".into(),
            format_id: "v+a".into(),
            output_directory: root.to_string_lossy().into(),
            expected_media_id: Some(id.into()),
            use_proxy: Some(true),
            keep_intermediate_files: true,
            subtitle_languages: vec!["en".into()],
            ..Default::default()
        };
        DownloadTaskRepository::new(db.clone())
            .insert(
                &DownloadTask {
                    format_details: options.format_details.clone(),
                    batch_id: options.batch_id.clone(),
                    group: Some(group),
                    id: id.into(),
                    url: options.url.clone(),
                    title: id.into(),
                    format_id: options.format_id.clone(),
                    status,
                    created_at_unix_ms: 1,
                },
                &options,
            )
            .unwrap();
        if status == DownloadTaskStatus::Completed {
            let path = root.join(format!("{id}.mp4"));
            std::fs::write(&path, b"video").unwrap();
            HistoryRepository::new(db.clone())
                .insert(
                    &DownloadResult {
                        task_id: id.into(),
                        title: id.into(),
                        output_paths: vec![path.to_string_lossy().into()],
                        total_bytes: 5,
                    },
                    1,
                )
                .unwrap();
        }
        options
    }
    #[test]
    fn startup_uses_real_files_only_resumes_open_rounds_and_preserves_snapshot_and_cancel() {
        use DownloadTaskStatus::*;
        let root = std::env::temp_dir().join(format!(
            "savebeam-recovery-{}-{}",
            std::process::id(),
            now()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let path = root.join("state.sqlite3");
        {
            let db = Database::open(&path).unwrap();
            let missing = seed(&db, &root, "missing", Some("current"), Completed);
            crate::infrastructure::database::subscriptions::SubscriptionRepository(db.clone())
                .mark_downloaded(&missing.url, &["missing".into()])
                .unwrap();
            seed(&db, &root, "present", Some("current"), Completed);
            seed(&db, &root, "interrupted", Some("current"), Downloading);
            seed(&db, &root, "archived", Some("old"), Completed);
            seed(
                &db,
                &root,
                "cancelling",
                Some("cancelled-round"),
                Cancelling,
            );
            seed(&db, &root, "failed", Some("failed-round"), Failed);
            seed(&db, &root, "legacy-active", None, Queued);
            seed(&db, &root, "legacy-done", None, Completed);
            std::fs::remove_file(root.join("missing.mp4")).unwrap();
            std::fs::remove_file(root.join("archived.mp4")).unwrap();
            std::fs::remove_file(root.join("legacy-done.mp4")).unwrap();
            std::fs::write(root.join("interrupted.fv.mp4.part"), b"partial bytes").unwrap();
        }
        {
            let db = Database::open(&path).unwrap();
            let registry = crate::services::download_registry::DownloadTaskRegistry::default();
            registry.initialize_from_database(db.clone()).unwrap();
            assert_eq!(registry.task("missing").unwrap().status, Queued);
            assert_eq!(registry.task("present").unwrap().status, Completed);
            assert_eq!(registry.task("interrupted").unwrap().status, Queued);
            assert_eq!(registry.task("archived").unwrap().status, Completed);
            let history = HistoryRepository::new(db.clone()).list().unwrap();
            assert!(history.iter().any(|r| r.task_id == "archived"));
            assert!(!history.iter().any(|r| r.task_id == "missing"));
            assert_eq!(registry.task("cancelling").unwrap().status, Cancelled);
            assert_eq!(registry.task("failed").unwrap().status, Failed);
            assert_eq!(files(&db, "archived").unwrap().state, "missing");
            let repo = DownloadTaskRepository::new(db.clone());
            let (_, options) = repo.get("missing").unwrap().unwrap();
            assert_eq!(options.batch_id.as_deref(), Some("current"));
            assert!(options.keep_intermediate_files);
            assert_eq!(options.use_proxy, Some(true));
            assert_eq!(options.subtitle_languages, ["en"]);
            assert_eq!(
                std::fs::read(root.join("interrupted.fv.mp4.part")).unwrap(),
                b"partial bytes"
            );
            assert!(registry.task("legacy-active").unwrap().batch_id.is_some());
            assert!(registry.task("legacy-done").unwrap().batch_id.is_none());
            assert!(
                !db.with_connection(|c| c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM downloaded_media WHERE media_id='missing')",
                    [],
                    |r| r.get::<_, bool>(0)
                ))
                .unwrap()
            );
            let batch = registry.task("legacy-active").unwrap().batch_id;
            let restarted = crate::services::download_registry::DownloadTaskRegistry::default();
            restarted.initialize_from_database(db).unwrap();
            assert_eq!(batch, restarted.task("legacy-active").unwrap().batch_id);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn empty_changed_and_symlink_outputs_are_unavailable_not_false_completion() {
        let root = std::env::temp_dir().join(format!(
            "savebeam-presence-{}-{}",
            std::process::id(),
            now()
        ));
        std::fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let db = Database::open_in_memory().unwrap();
        seed(
            &db,
            &root,
            "file",
            Some("one"),
            DownloadTaskStatus::Completed,
        );
        assert_eq!(files(&db, "file").unwrap().state, "present");
        std::fs::write(root.join("file.mp4"), b"").unwrap();
        assert_eq!(files(&db, "file").unwrap().state, "unavailable");
        std::fs::write(root.join("file.mp4"), b"changed length").unwrap();
        assert_eq!(files(&db, "file").unwrap().state, "unavailable");
        std::fs::remove_file(root.join("file.mp4")).unwrap();
        assert_eq!(files(&db, "file").unwrap().state, "missing");
        #[cfg(unix)]
        {
            std::fs::write(root.join("other.mp4"), b"video").unwrap();
            std::os::unix::fs::symlink(root.join("other.mp4"), root.join("file.mp4")).unwrap();
            assert_eq!(files(&db, "file").unwrap().state, "unavailable");
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
