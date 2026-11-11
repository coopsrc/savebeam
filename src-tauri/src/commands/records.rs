//! Record-wide actions use a confirmed membership snapshot, never frontend paths.
use crate::services::record_deletion::{DeleteResult, validate_members};
use crate::{
    commands::{
        ipc::{CommandResult, DOWNLOAD_REMOVED_EVENT, EventPayload},
        media::configured_media_engine,
    },
    domain::{
        download::DownloadTaskStatus,
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{
        DatabaseManager,
        repositories::{DownloadTaskRepository, HistoryRepository},
    },
    services::download_registry::DownloadTaskRegistry,
};
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub async fn get_history_file_presence(
    task_id: String,
    database: State<'_, DatabaseManager>,
) -> CommandResult<crate::services::task_recovery::FilePresence> {
    let db = database.database()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::task_recovery::files(&db, &task_id)
    })
    .await
    .map_err(|_| AppError::new(ErrorCode::Unknown, "文件状态检查未完成。", true))?
}

#[tauri::command]
pub async fn get_record_group_file_presence(
    group_key: String,
    database: State<'_, DatabaseManager>,
) -> CommandResult<crate::services::task_recovery::FilePresence> {
    let db = database.database()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut total = crate::services::task_recovery::FilePresence {
            state: "present".into(),
            missing_count: 0,
            total_count: 0,
        };
        for record in HistoryRepository::new(db.clone())
            .list()?
            .into_iter()
            .filter(|r| r.group.as_ref().is_some_and(|g| g.key == group_key))
        {
            let item = crate::services::task_recovery::files(&db, &record.task_id)?;
            total.missing_count += item.missing_count;
            total.total_count += item.total_count;
            if item.state == "unavailable" {
                total.state = "unavailable".into();
            }
        }
        if total.missing_count > 0 && total.state == "present" {
            total.state = "missing".into();
        }
        Ok(total)
    })
    .await
    .map_err(|_| AppError::new(ErrorCode::Unknown, "文件状态检查未完成。", true))?
}

#[tauri::command]
pub async fn redownload_missing_history(
    app: AppHandle,
    task_id: String,
    database: State<'_, DatabaseManager>,
) -> CommandResult<crate::domain::download::DownloadTask> {
    let db = database.database()?;
    let presence = crate::services::task_recovery::files(&db, &task_id)?;
    if presence.state == "present" {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "文件仍存在，请使用来源与版本操作。",
            false,
        ));
    }
    let (_, options) = crate::services::source_versions::history_options(&db, &task_id)?;
    let active = DownloadTaskRepository::new(db).list_visible()?;
    if active.iter().any(|(t, o)| {
        matches!(
            t.status,
            DownloadTaskStatus::Queued
                | DownloadTaskStatus::Preparing
                | DownloadTaskStatus::Downloading
                | DownloadTaskStatus::PostProcessing
                | DownloadTaskStatus::Cancelling
        ) && (o.version_parent_task_id.as_deref() == Some(task_id.as_str())
            || (o.url == options.url && o.playlist_items == options.playlist_items))
    }) {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "此条目已有进行中的下载，请等待完成。",
            false,
        ));
    }
    super::versions::redownload_media_version(
        app,
        task_id,
        Some(options.use_proxy.unwrap_or(false)),
    )
    .await
}

#[tauri::command]
pub fn get_record_group_members(
    group_key: String,
    history: bool,
    tasks: State<'_, DownloadTaskRegistry>,
    database: State<'_, DatabaseManager>,
) -> CommandResult<Vec<String>> {
    if history {
        Ok(HistoryRepository::new(database.database()?)
            .list()?
            .into_iter()
            .filter(|r| r.group.as_ref().is_some_and(|g| g.key == group_key))
            .map(|r| r.task_id)
            .collect())
    } else {
        Ok(tasks
            .list()?
            .into_iter()
            .filter(|r| {
                r.status != DownloadTaskStatus::Completed
                    && r.group.as_ref().is_some_and(|g| g.key == group_key)
            })
            .map(|r| r.id)
            .collect())
    }
}

#[tauri::command]
pub async fn delete_record_group(
    app: AppHandle,
    group_key: String,
    task_ids: Vec<String>,
    history: bool,
    delete_files: bool,
    tasks: State<'_, DownloadTaskRegistry>,
    database: State<'_, DatabaseManager>,
) -> CommandResult<DeleteResult> {
    let db = database.database()?;
    let registry = tasks.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        validate_members(&db, &group_key, &task_ids)?;
        let result = if history {
            crate::services::record_deletion::delete_history(&db, &task_ids, delete_files)
        } else {
            crate::services::record_deletion::delete_tasks(&registry, &task_ids, |task| {
                super::downloads::emit_task(&app, task)
            })
        };
        if !history {
            for id in &result.removed_ids {
                let _ = app.emit(DOWNLOAD_REMOVED_EVENT, EventPayload::new(id));
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| AppError::new(ErrorCode::Unknown, "整组删除未完成，请刷新后重试。", true))?
}

#[tauri::command]
pub async fn get_record_thumbnail(
    app: AppHandle,
    task_id: String,
    refresh: Option<bool>,
    database: State<'_, DatabaseManager>,
) -> CommandResult<Option<String>> {
    let db = database.database()?;
    tauri::async_runtime::spawn_blocking(move || {
        if !refresh.unwrap_or(false) {
            return crate::infrastructure::database::artwork::get(&db, &task_id);
        }
        let (_, options) = DownloadTaskRepository::new(db.clone())
            .get(&task_id)?
            .ok_or_else(|| AppError::new(ErrorCode::InvalidUrl, "找不到对应的下载记录。", false))?;
        let source = options
            .group
            .as_ref()
            .map_or(options.url.as_str(), |g| g.source_url.as_str());
        let network = crate::services::network_preferences::load_task_network_preferences(
            db.clone(),
            options.use_proxy,
        )?;
        let cookies =
            super::downloads::load_cookie_preferences(app.state::<DatabaseManager>().inner())?;
        let raw = configured_media_engine(&app, options.use_proxy)?
            .inspect_with_cookies(source, &cookies)?;
        let media = crate::services::media_mapper::map_media_info(&raw, source)?;
        let image = media.thumbnail_url.as_deref().and_then(|url| {
            crate::services::thumbnail_preview::load_thumbnail_with_network(
                url,
                source,
                raw["http_headers"]["User-Agent"].as_str(),
                &network,
            )
        });
        if let Some(value) = &image {
            crate::infrastructure::database::artwork::attach(&db, &task_id, value)?;
        }
        Ok(image)
    })
    .await
    .map_err(|_| AppError::new(ErrorCode::Unknown, "封面读取未完成，请重试。", true))?
}
