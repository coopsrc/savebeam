use crate::{
    domain::{
        download::{DownloadTask, DownloadTaskStatus},
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{Database, repositories::DownloadTaskRepository},
    services::download_registry::DownloadTaskRegistry,
};
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub removed_ids: Vec<String>,
    pub error: Option<String>,
}

pub fn validate_members(db: &Database, key: &str, ids: &[String]) -> Result<(), AppError> {
    if key.len() > 8192
        || ids.is_empty()
        || ids.len() > 1000
        || ids.iter().any(|id| id.len() > 128)
        || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
    {
        return Err(invalid());
    }
    let repo = DownloadTaskRepository::new(db.clone());
    for id in ids {
        if repo
            .get(id)?
            .is_none_or(|(task, _)| task.group.is_none_or(|g| g.key != key))
        {
            return Err(invalid());
        }
    }
    Ok(())
}
fn invalid() -> AppError {
    AppError::new(
        ErrorCode::PermissionDenied,
        "删除范围已变化，请重新确认整组记录。",
        false,
    )
}

pub fn delete_history(db: &Database, ids: &[String], files: bool) -> DeleteResult {
    let mut result = DeleteResult {
        removed_ids: vec![],
        error: None,
    };
    for id in ids {
        match super::history_deletion::delete_history_entry(db, id, files) {
            Ok(_) => result.removed_ids.push(id.clone()),
            Err(e) => {
                result.error = Some(e.message);
                break;
            }
        }
    }
    result
}

pub fn delete_tasks(
    tasks: &DownloadTaskRegistry,
    ids: &[String],
    mut emit: impl FnMut(&DownloadTask),
) -> DeleteResult {
    let mut result = DeleteResult {
        removed_ids: vec![],
        error: None,
    };
    // Signal the entire confirmed snapshot before waiting, so queued siblings cannot start later.
    for id in ids {
        if let Ok(task) = tasks.task(id)
            && matches!(
                task.status,
                DownloadTaskStatus::Queued
                    | DownloadTaskStatus::Preparing
                    | DownloadTaskStatus::Downloading
                    | DownloadTaskStatus::PostProcessing
                    | DownloadTaskStatus::Cancelling
            )
        {
            match tasks.cancel(id) {
                Ok(task) => emit(&task),
                Err(e) => {
                    result.error = Some(e.message);
                    return result;
                }
            }
        }
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    for id in ids {
        loop {
            let task = match tasks.task(id) {
                Ok(t) => t,
                Err(_) => {
                    result.removed_ids.push(id.clone());
                    break;
                }
            };
            if task.status == DownloadTaskStatus::Completed {
                break;
            }
            if matches!(
                task.status,
                DownloadTaskStatus::Failed | DownloadTaskStatus::Cancelled
            ) {
                match tasks.remove(id) {
                    Ok(_) => result.removed_ids.push(id.clone()),
                    Err(e) => result.error = Some(e.message),
                };
                break;
            }
            if std::time::Instant::now() >= deadline {
                result.error = Some("部分任务仍在停止，请等待后重试删除。".into());
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        if result.error.is_some() {
            break;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::download::{DownloadGroupHint, DownloadGroupKind, DownloadOptions, DownloadResult},
        infrastructure::database::repositories::HistoryRepository,
    };
    #[test]
    fn confirmed_snapshot_cancels_whole_group_but_keeps_completed_other_and_new_tasks() {
        let db = Database::open_in_memory().unwrap();
        let tasks = DownloadTaskRegistry::default();
        tasks.initialize_from_database(db.clone()).unwrap();
        let group = super::super::download_groups::make(
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
            group: Some(group.clone()),
            url: "https://example.com/list".into(),
            ..Default::default()
        };
        let complete = tasks.create(options.clone()).unwrap();
        tasks
            .transition(&complete.id, DownloadTaskStatus::Preparing)
            .unwrap();
        tasks
            .transition(&complete.id, DownloadTaskStatus::Downloading)
            .unwrap();
        tasks
            .transition(&complete.id, DownloadTaskStatus::Completed)
            .unwrap();
        let history = HistoryRepository::new(db.clone());
        history
            .insert(
                &DownloadResult {
                    task_id: complete.id.clone(),
                    title: "saved".into(),
                    output_paths: vec!["/fixture/a.mp4".into()],
                    total_bytes: 1,
                },
                1,
            )
            .unwrap();
        let active = tasks.create(options.clone()).unwrap();
        tasks
            .transition(&active.id, DownloadTaskStatus::Preparing)
            .unwrap();
        let queued = tasks.create(options.clone()).unwrap();
        let other = tasks
            .create(DownloadOptions {
                url: "https://example.com/other".into(),
                ..Default::default()
            })
            .unwrap();
        let ids = vec![active.id.clone(), queued.id.clone()];
        assert!(validate_members(&db, &group.key, &[active.id.clone(), other.id.clone()]).is_err());
        assert_eq!(
            tasks.task(&active.id).unwrap().status,
            DownloadTaskStatus::Preparing
        );
        validate_members(&db, &group.key, &ids).unwrap();
        let added = tasks.create(options).unwrap();
        let result = delete_tasks(&tasks, &ids, |task| {
            if task.status == DownloadTaskStatus::Cancelling {
                tasks
                    .transition(&task.id, DownloadTaskStatus::Cancelled)
                    .unwrap();
            }
        });
        assert!(result.error.is_none());
        assert_eq!(result.removed_ids, ids);
        assert_eq!(tasks.list().unwrap().len(), 3);
        for id in [&complete.id, &other.id, &added.id] {
            assert!(tasks.task(id).is_ok());
        }
        assert!(history.get(&complete.id).unwrap().is_some());
        let deleted = delete_history(&db, std::slice::from_ref(&complete.id), false);
        assert!(deleted.error.is_none());
        assert!(history.list().unwrap().is_empty());
        assert!(
            DownloadTaskRepository::new(db)
                .get(&complete.id)
                .unwrap()
                .is_some()
        );
    }
}
