//! Explicit, local-only subscription actions. Checks never schedule downloads.
use crate::{
    commands::{
        components::ComponentRegistry,
        downloads::{load_cookie_preferences, queue_download},
        ipc::CommandResult,
        media::{configured_media_engine, subscription_engine},
    },
    domain::{
        download::{DownloadOptions, DownloadTask, DownloadTaskStatus},
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{
        DatabaseManager,
        repositories::{DownloadTaskRepository, HistoryRepository},
        subscriptions::{SeriesSnapshot, Subscription, SubscriptionRepository},
    },
    services::{download_registry::DownloadTaskRegistry, subscriptions::map_snapshot},
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Default)]
pub struct SubscriptionOperations(Arc<Mutex<()>>);
#[derive(Clone, Default)]
pub struct SubscriptionMetadataOperations(Arc<Mutex<()>>);

fn busy() -> AppError {
    AppError::new(
        ErrorCode::Unknown,
        "正在处理另一项订阅操作，请稍后重试。",
        true,
    )
}
fn invalid(message: &str) -> AppError {
    AppError::new(ErrorCode::InvalidUrl, message, false)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesCandidate {
    url: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedSubscriptionItems {
    tasks: Vec<DownloadTask>,
    error: Option<String>,
}

#[tauri::command]
pub fn list_subscriptions(
    database: State<'_, DatabaseManager>,
) -> CommandResult<Vec<Subscription>> {
    SubscriptionRepository(database.database()?).list()
}

#[tauri::command]
pub fn get_subscription_candidates(
    database: State<'_, DatabaseManager>,
) -> CommandResult<Vec<SeriesCandidate>> {
    let mut seen = HashSet::new();
    Ok(DownloadTaskRepository::new(database.database()?)
        .list()?
        .into_iter()
        .filter(|(task, options)| {
            task.status == DownloadTaskStatus::Completed
                && options.playlist_item_count.is_some()
                && seen.insert(task.url.clone())
        })
        .map(|(task, _)| SeriesCandidate {
            url: task.url,
            title: task.title,
        })
        .take(100)
        .collect())
}

fn scan(app: &AppHandle, url: &str) -> CommandResult<SeriesSnapshot> {
    let cookies = load_cookie_preferences(app.state::<DatabaseManager>().inner())?;
    map_snapshot(&subscription_engine(app)?.inspect_with_cookies(url, &cookies)?)
}

fn apply(app: &AppHandle, url: &str, snapshot: &SeriesSnapshot) -> CommandResult<i64> {
    let database = app.state::<DatabaseManager>().database()?;
    let repo = SubscriptionRepository(database.clone());
    // Backfill only exact ID suffixes in still-existing final files from completed history.
    // Older names with no ID are intentionally left pending, never guessed from position/title.
    let mut files = Vec::new();
    let history = HistoryRepository::new(database.clone());
    for (task, _) in DownloadTaskRepository::new(database).list()? {
        if task.url == url
            && task.status == DownloadTaskStatus::Completed
            && let Some(record) = history.get(&task.id)?
        {
            files.extend(record.output_paths);
        }
    }
    let known: Vec<String> = snapshot
        .entries
        .iter()
        .filter(|entry| {
            files.iter().any(|file| {
                let path = Path::new(file);
                path.is_file()
                    && path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .is_some_and(|stem| stem.ends_with(&format!(" [{}]", entry.id)))
            })
        })
        .map(|entry| entry.id.clone())
        .collect();
    let checked_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| invalid("系统时间不可用。"))?
        .as_millis() as u64;
    let id = repo.apply(url, snapshot, checked_at)?;
    repo.mark_downloaded(url, &known)?;
    Ok(id)
}

async fn worker<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&AppHandle) -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    let operations = app.state::<SubscriptionOperations>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operations.0.try_lock().map_err(|_| busy())?;
        action(&app)
    })
    .await
    .map_err(|_| AppError::new(ErrorCode::Unknown, "订阅操作中断，请重试。", true))?
}

#[tauri::command]
pub async fn subscribe_series(app: AppHandle, url: String) -> CommandResult<i64> {
    worker(app, move |app| {
        if url.len() > 4096 {
            return Err(invalid("系列链接过长。"));
        }
        let mut parsed =
            reqwest::Url::parse(url.trim()).map_err(|_| invalid("请输入有效的系列链接。"))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return Err(invalid("仅支持不含登录凭据的 HTTP(S) 系列链接。"));
        }
        parsed.set_fragment(None);
        let url = parsed.as_str();
        let repo = SubscriptionRepository(app.state::<DatabaseManager>().database()?);
        let subscriptions = repo.list()?;
        if let Some(existing) = subscriptions.iter().find(|item| item.url == url) {
            return Ok(existing.id);
        }
        if subscriptions.len() >= 100 {
            return Err(invalid("最多支持 100 个系列订阅，请先取消不需要的订阅。"));
        }
        let snapshot = scan(app, url)?;
        apply(app, url, &snapshot)
    })
    .await
}

#[tauri::command]
pub async fn check_subscription(app: AppHandle, id: i64) -> CommandResult<()> {
    worker(app, move |app| {
        let subscription =
            SubscriptionRepository(app.state::<DatabaseManager>().database()?).get(id)?;
        let snapshot = scan(app, &subscription.url)?;
        if snapshot.source_id != subscription.source_id {
            return Err(invalid("系列 ID 已变化，已保留上次检查结果。请确认链接。"));
        }
        apply(app, &subscription.url, &snapshot)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn inspect_subscription_entries(
    app: AppHandle,
    id: i64,
    media_ids: Vec<String>,
) -> CommandResult<Vec<crate::infrastructure::database::subscriptions::SubscriptionEntryMetadata>> {
    let operations = app
        .state::<SubscriptionMetadataOperations>()
        .inner()
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = operations.0.try_lock().map_err(|_| busy())?;
        let wanted: HashSet<_> = media_ids.iter().collect();
        if wanted.is_empty()
            || wanted.len() > 5
            || wanted.len() != media_ids.len()
            || media_ids.iter().any(|id| id.is_empty() || id.len() > 512)
        {
            return Err(invalid("每批请选择 1–5 条不重复的订阅信息。"));
        }
        let repo = SubscriptionRepository(app.state::<DatabaseManager>().database()?);
        let subscription = repo.get(id)?;
        let entries: Vec<_> = subscription
            .entries
            .iter()
            .filter(|entry| wanted.contains(&entry.id) && entry.available)
            .cloned()
            .collect();
        if entries.len() != wanted.len() {
            return Err(invalid("所选条目已移除或不可用，请检查列表后重试。"));
        }
        let cookies = load_cookie_preferences(app.state::<DatabaseManager>().inner())?;
        let indices: Vec<_> = entries.iter().map(|e| e.index).collect();
        let raw = subscription_engine(&app)?
            .for_subscription_details(&indices)?
            .inspect_with_cookies(&subscription.url, &cookies)?;
        repo.save_metadata(
            id,
            &crate::services::subscriptions::map_entry_metadata(&raw, &entries),
        )
    })
    .await
    .map_err(|_| invalid("读取订阅条目信息中断，请重试。"))?
}

#[tauri::command]
pub async fn unsubscribe_series(app: AppHandle, id: i64) -> CommandResult<()> {
    worker(app, move |app| {
        SubscriptionRepository(app.state::<DatabaseManager>().database()?).delete(id)
    })
    .await
}

#[tauri::command]
pub async fn download_subscription_items(
    app: AppHandle,
    id: i64,
    media_ids: Vec<String>,
    use_proxy: Option<bool>,
    download_options: Option<crate::domain::download_defaults::DownloadOptionDefaults>,
) -> CommandResult<QueuedSubscriptionItems> {
    worker(app, move |app| {
        let wanted: HashSet<_> = media_ids.iter().collect();
        if wanted.is_empty() || wanted.len() > 50 || wanted.len() != media_ids.len() {
            return Err(invalid("每次请选择 1–50 个不重复的视频。"));
        }
        let database = app.state::<DatabaseManager>();
        let repo = SubscriptionRepository(database.database()?);
        let download_options = match download_options {
            Some(value) => {
                crate::services::download_defaults::validate(&value)?;
                value
            }
            None => crate::services::download_defaults::load(database.database()?)?,
        };
        let subscription = repo.get(id)?;
        let use_proxy = Some(use_proxy.unwrap_or(false));
        let cookies = load_cookie_preferences(app.state::<DatabaseManager>().inner())?;
        let snapshot = map_snapshot(
            &configured_media_engine(app, use_proxy)?
                .for_subscription()
                .inspect_with_cookies(&subscription.url, &cookies)?,
        )?;
        if snapshot.source_id != subscription.source_id {
            return Err(invalid("系列 ID 已变化，请重新确认订阅。"));
        }
        apply(app, &subscription.url, &snapshot)?;
        let current = repo.get(id)?;
        let chosen: Vec<_> = current
            .entries
            .iter()
            .filter(|entry| wanted.contains(&entry.id))
            .collect();
        if chosen.len() != wanted.len()
            || chosen.iter().any(|entry| {
                entry.downloaded
                    || !entry.available
                    || !snapshot
                        .entries
                        .iter()
                        .any(|fresh| fresh.id == entry.id && fresh.available)
            })
        {
            return Err(invalid(
                "所选条目已下载、不可用或已移出当前检查范围。请刷新列表后重选。",
            ));
        }
        let active: Vec<_> = DownloadTaskRepository::new(database.database()?)
            .list()?
            .into_iter()
            .filter(|(task, options)| {
                (task.url == subscription.url
                    || options
                        .playlist_part
                        .as_ref()
                        .is_some_and(|p| p.source_url == subscription.url))
                    && matches!(
                        task.status,
                        DownloadTaskStatus::Queued
                            | DownloadTaskStatus::Preparing
                            | DownloadTaskStatus::Downloading
                            | DownloadTaskStatus::PostProcessing
                            | DownloadTaskStatus::Cancelling
                    )
            })
            .collect();
        if active.iter().any(|(_, options)| {
            options.expected_media_id.as_ref().is_none_or(|id| {
                wanted.contains(id)
                    || options
                        .playlist_part
                        .as_ref()
                        .is_some_and(|p| wanted.contains(&p.parent_id))
            })
        }) {
            return Err(invalid(
                "所选系列条目已有进行中的下载，请等待或前往任务页处理。",
            ));
        }
        let mut response = QueuedSubscriptionItems {
            tasks: Vec::new(),
            error: None,
        };
        for entry in chosen {
            let mut options = DownloadOptions {
                title: format!(
                    "{} · {}",
                    current.title,
                    if entry.title.trim().is_empty() {
                        &entry.id
                    } else {
                        &entry.title
                    }
                )
                .chars()
                .take(1024)
                .collect(),
                url: subscription.url.clone(),
                format_id: if download_options.audio_only {
                    "bestaudio/best"
                } else {
                    "bestvideo+bestaudio/best"
                }
                .into(),
                playlist_item_count: Some(1),
                playlist_items: Some(vec![entry.index]),
                expected_media_id: Some(entry.id.clone()),
                use_proxy,
                ..Default::default()
            };
            download_options.apply_to(&mut options);
            match queue_download(
                app.clone(),
                options,
                app.state::<ComponentRegistry>().inner(),
                app.state::<DownloadTaskRegistry>().inner(),
                database.inner(),
            ) {
                Ok(task) => response.tasks.push(task),
                Err(error) => {
                    response.error = Some(error.message);
                    break;
                }
            }
        }
        Ok(response)
    })
    .await
}
