//! Explicit local history/version operations. No automatic remote source polling.
use crate::{
    commands::{
        components::ComponentRegistry,
        downloads::{launch_next_task, load_cookie_preferences, validate_task_options},
        ipc::CommandResult,
        media::configured_media_engine,
    },
    domain::{
        download::DownloadTask,
        source_version::{MediaVersion, SourceComparison, SourceObservation, compare},
    },
    infrastructure::database::{DatabaseManager, versions::VersionRepository},
    services::{
        download_registry::DownloadTaskRegistry,
        source_versions::{
            ensure_baseline, history_options, invalid, prepare_version_options, version_directory,
        },
    },
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State};

// Bound expensive local hashing and explicit remote checks, including crafted IPC.
static OPERATION_ACTIVE: AtomicBool = AtomicBool::new(false);
struct Operation;
impl Operation {
    fn acquire() -> CommandResult<Self> {
        OPERATION_ACTIVE
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .map(|_| Self)
            .map_err(|_| invalid("另一个来源或版本操作正在进行，请稍后重试。"))
    }
}
impl Drop for Operation {
    fn drop(&mut self) {
        OPERATION_ACTIVE.store(false, Ordering::Release);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCheck {
    pub comparison: SourceComparison,
    pub current: SourceObservation,
    pub title: String,
}

#[tauri::command]
pub async fn list_media_versions(
    task_id: String,
    database: State<'_, DatabaseManager>,
) -> CommandResult<Vec<MediaVersion>> {
    let db = database.database()?;
    let operation = Operation::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        ensure_baseline(&db, &task_id)?;
        VersionRepository(db).list(&task_id)
    })
    .await
    .map_err(|_| invalid("读取历史版本失败。"))?
}

fn inspect(
    app: &AppHandle,
    id: &str,
    use_proxy: bool,
) -> CommandResult<(SourceCheck, serde_json::Value)> {
    let db = app.state::<DatabaseManager>().database()?;
    let (record, options) = history_options(&db, id)?;
    if record.output_paths.len() != 1 || options.playlist_item_count.is_some_and(|count| count != 1)
    {
        return Err(invalid(
            "此旧任务包含多条媒体，请按单条媒体分别重新解析后保存版本。",
        ));
    }
    let baseline = ensure_baseline(&db, id)?;
    let index = options
        .playlist_items
        .as_ref()
        .and_then(|items| items.first())
        .copied()
        .or_else(|| (options.playlist_item_count == Some(1)).then_some(1));
    if options
        .playlist_items
        .as_ref()
        .is_some_and(|items| items.len() != 1)
    {
        return Err(invalid("历史条目范围不唯一，请重新解析来源。"));
    }
    let engine = configured_media_engine(app, Some(use_proxy))?.for_source_check(index)?;
    let raw = engine.inspect_with_cookies(
        &options.url,
        &load_cookie_preferences(app.state::<DatabaseManager>().inner())?,
    )?;
    let item = if let Some(entries) = raw.get("entries").and_then(serde_json::Value::as_array) {
        if entries.len() != 1 {
            return Err(invalid("链接对应多条媒体，请重新解析并确认目标条目。"));
        }
        entries[0].clone()
    } else {
        raw
    };
    let current =
        SourceObservation::from_raw(&item).ok_or_else(|| invalid("无法读取有效的媒体标识。"))?;
    let mut comparison = compare(baseline.source.as_ref(), &current);
    if options
        .expected_media_id
        .as_ref()
        .is_some_and(|expected| expected != &current.media_id)
    {
        comparison = SourceComparison {
            status: "identity_changed".into(),
            reasons: vec!["系列位置已改变或条目被替换，请重新解析并确认目标。".into()],
        };
    }
    let title = item
        .get("title")
        .and_then(serde_json::Value::as_str)
        .filter(|title| !title.trim().is_empty() && title.chars().count() <= 1024)
        .unwrap_or(&record.title)
        .to_owned();
    Ok((
        SourceCheck {
            comparison,
            current,
            title,
        },
        item,
    ))
}

#[tauri::command]
pub async fn check_history_source(
    app: AppHandle,
    task_id: String,
    use_proxy: Option<bool>,
) -> CommandResult<SourceCheck> {
    let operation = Operation::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        inspect(&app, &task_id, use_proxy.unwrap_or(false)).map(|(check, _)| check)
    })
    .await
    .map_err(|_| invalid("来源检查未完成，请重试。"))?
}

#[tauri::command]
pub async fn redownload_media_version(
    app: AppHandle,
    task_id: String,
    use_proxy: Option<bool>,
) -> CommandResult<DownloadTask> {
    let operation = Operation::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let proxy = use_proxy.unwrap_or(false);
        let (check, item) = inspect(&app, &task_id, proxy)?;
        if check.comparison.status == "identity_changed" {
            return Err(invalid(
                "媒体标识已改变，已拒绝沿用旧版本任务，请重新解析来源。",
            ));
        }
        let db = app.state::<DatabaseManager>().database()?;
        let (_, old_options) = history_options(&db, &task_id)?;
        let mut options = prepare_version_options(
            old_options,
            &task_id,
            proxy,
            &check.current,
            check.title,
            &item,
        )?;
        validate_task_options(&options)?;
        options.output_directory = version_directory(&db, &task_id)?
            .to_string_lossy()
            .into_owned();
        let tasks = app.state::<DownloadTaskRegistry>();
        let task = tasks.create(options)?;
        tasks.enqueue(&task.id)?;
        launch_next_task(
            app.clone(),
            app.state::<ComponentRegistry>().inner().clone(),
            tasks.inner().clone(),
        );
        Ok(task)
    })
    .await
    .map_err(|_| invalid("新版本任务创建失败，请重试。"))?
}

#[cfg(test)]
mod tests {
    #[test]
    fn explicit_version_operations_are_bounded_and_release_the_gate_on_drop() {
        let operation = super::Operation::acquire().unwrap();
        assert!(super::Operation::acquire().is_err());
        drop(operation);
        assert!(super::Operation::acquire().is_ok());
    }
}
