//! Typed repositories over the local SQLite database.

use rusqlite::{OptionalExtension, params};
use serde::{Serialize, de::DeserializeOwned};

use crate::{
    domain::{
        download::{
            CookieBrowser, DownloadConflictStrategy, DownloadHistoryRecord, DownloadOptions,
            DownloadResult, DownloadTask, DownloadTaskStatus,
        },
        error::{AppError, ErrorCode},
    },
    infrastructure::database::Database,
};

#[derive(Debug, Clone)]
pub struct SettingsRepository {
    database: Database,
}

impl SettingsRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, AppError> {
        validate_setting_key(key)?;
        let value = self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT value_json FROM app_settings WHERE setting_key = ?1",
                    [key],
                    |row| row.get::<_, String>(0),
                )
                .optional()
        })?;
        value
            .map(|value| {
                serde_json::from_str(&value).map_err(|error| {
                    AppError::new(ErrorCode::Unknown, "本地设置数据无法读取。", false)
                        .with_diagnostic(error.to_string())
                })
            })
            .transpose()
    }

    pub fn set<T: Serialize>(
        &self,
        key: &str,
        value: &T,
        updated_at_unix_ms: u64,
    ) -> Result<(), AppError> {
        validate_setting_key(key)?;
        let value_json = serde_json::to_string(value).map_err(|error| {
            AppError::new(ErrorCode::Unknown, "本地设置无法保存。", false)
                .with_diagnostic(error.to_string())
        })?;
        let updated_at = to_sql_integer(updated_at_unix_ms)?;
        self.database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO app_settings(setting_key, value_json, updated_at_unix_ms)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(setting_key) DO UPDATE SET
                     value_json = excluded.value_json,
                     updated_at_unix_ms = excluded.updated_at_unix_ms",
                params![key, value_json, updated_at],
            )
        })?;
        Ok(())
    }

    pub fn remove(&self, key: &str) -> Result<bool, AppError> {
        validate_setting_key(key)?;
        self.database
            .with_connection(|connection| {
                connection.execute("DELETE FROM app_settings WHERE setting_key = ?1", [key])
            })
            .map(|changed| changed > 0)
    }
}

#[derive(Debug, Clone)]
pub struct DownloadTaskRepository {
    database: Database,
}

impl DownloadTaskRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn insert(&self, task: &DownloadTask, options: &DownloadOptions) -> Result<(), AppError> {
        let playlist_items_json = options
            .playlist_items
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| AppError::new(ErrorCode::InvalidPath, "无法保存播放列表选择。", false))?;
        let created_at = to_sql_integer(task.created_at_unix_ms)?;
        let subtitle_languages =
            serde_json::to_string(&options.subtitle_languages).map_err(|error| {
                AppError::new(ErrorCode::Unknown, "任务选项无法保存。", false)
                    .with_diagnostic(error.to_string())
            })?;
        self.database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO download_tasks(
                     task_id, url, title, format_id, output_directory,
                     subtitle_languages_json, status, created_at_unix_ms, updated_at_unix_ms,
                     conflict_strategy, playlist_item_count, audio_only,
                     write_automatic_subtitles, write_thumbnail, write_info_json, embed_metadata,
                     cookies_file_path, cookies_browser, cookie_access_confirmed, merge_container,
                     keep_intermediate_files, playlist_items_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                params![
                    task.id,
                    options.url,
                    task.title,
                    task.format_id,
                    options.output_directory,
                    subtitle_languages,
                    status_name(task.status),
                    created_at,
                    conflict_strategy_name(options.conflict_strategy),
                    options.playlist_item_count.map(i64::from),
                    options.audio_only,
                    options.write_automatic_subtitles,
                    options.write_thumbnail,
                    options.write_info_json,
                    options.embed_metadata,
                    options.cookies_file_path,
                    options.cookies_browser.map(|browser| browser.yt_dlp_name()),
                    options.cookie_access_confirmed,
                    options.merge_container.map(|container| container.extension()),
                    options.keep_intermediate_files,
                    playlist_items_json,
                ],
            )
        })?;
        Ok(())
    }

    pub fn update_status(
        &self,
        task_id: &str,
        status: DownloadTaskStatus,
        updated_at_unix_ms: u64,
    ) -> Result<bool, AppError> {
        let updated_at = to_sql_integer(updated_at_unix_ms)?;
        self.database
            .with_connection(|connection| {
                connection.execute(
                    "UPDATE download_tasks SET status = ?2, updated_at_unix_ms = ?3 WHERE task_id = ?1",
                    params![task_id, status_name(status), updated_at],
                )
            })
            .map(|changed| changed > 0)
    }

    pub fn get(&self, task_id: &str) -> Result<Option<(DownloadTask, DownloadOptions)>, AppError> {
        self.database.with_connection(|connection| {
            connection
                .query_row(
                    "SELECT task_id, url, title, format_id, output_directory,
                            subtitle_languages_json, conflict_strategy, status, created_at_unix_ms,
                            playlist_item_count, audio_only, write_automatic_subtitles,
                            write_thumbnail, write_info_json, embed_metadata,
                            cookies_file_path, cookies_browser, cookie_access_confirmed, merge_container,
                            keep_intermediate_files, playlist_items_json
                     FROM download_tasks WHERE task_id = ?1",
                    [task_id],
                    task_from_row,
                )
                .optional()
        })
    }

    pub fn list(&self) -> Result<Vec<(DownloadTask, DownloadOptions)>, AppError> {
        self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT task_id, url, title, format_id, output_directory,
                        subtitle_languages_json, conflict_strategy, status, created_at_unix_ms,
                        playlist_item_count, audio_only, write_automatic_subtitles,
                        write_thumbnail, write_info_json, embed_metadata,
                        cookies_file_path, cookies_browser, cookie_access_confirmed, merge_container,
                        keep_intermediate_files, playlist_items_json
                 FROM download_tasks ORDER BY created_at_unix_ms DESC",
            )?;
            let rows = statement.query_map([], task_from_row)?;
            rows.collect()
        })
    }
}

#[derive(Debug, Clone)]
pub struct HistoryRepository {
    database: Database,
}

impl HistoryRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn insert(
        &self,
        result: &DownloadResult,
        completed_at_unix_ms: u64,
    ) -> Result<(), AppError> {
        let paths_json = serde_json::to_string(&result.output_paths).map_err(|error| {
            AppError::new(ErrorCode::Unknown, "下载记录无法保存。", false)
                .with_diagnostic(error.to_string())
        })?;
        let total_bytes = to_sql_integer(result.total_bytes)?;
        let completed_at = to_sql_integer(completed_at_unix_ms)?;
        self.database.with_connection(|connection| {
            connection.execute(
                "INSERT INTO download_history(task_id, output_paths_json, total_bytes, completed_at_unix_ms)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(task_id) DO UPDATE SET
                     output_paths_json = excluded.output_paths_json,
                     total_bytes = excluded.total_bytes,
                     completed_at_unix_ms = excluded.completed_at_unix_ms",
                params![result.task_id, paths_json, total_bytes, completed_at],
            )
        })?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<DownloadHistoryRecord>, AppError> {
        self.search("")
    }

    pub fn get(&self, task_id: &str) -> Result<Option<DownloadHistoryRecord>, AppError> {
        self.database.with_connection(|connection| {
            connection.query_row(
                "SELECT h.task_id, t.title, h.output_paths_json, h.total_bytes, h.completed_at_unix_ms
                 FROM download_history h JOIN download_tasks t ON t.task_id = h.task_id
                 WHERE h.task_id = ?1",
                [task_id],
                history_from_row,
            ).optional()
        })
    }

    pub fn search(&self, query: &str) -> Result<Vec<DownloadHistoryRecord>, AppError> {
        let pattern = format!("%{}%", query.trim());
        self.database.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT h.task_id, t.title, h.output_paths_json, h.total_bytes, h.completed_at_unix_ms
                 FROM download_history h
                 JOIN download_tasks t ON t.task_id = h.task_id
                 WHERE ?1 = '%%' OR t.title LIKE ?1 OR h.output_paths_json LIKE ?1
                 ORDER BY h.completed_at_unix_ms DESC",
            )?;
            let rows = statement.query_map([pattern], history_from_row)?;
            rows.collect()
        })
    }

    pub fn delete(&self, task_id: &str) -> Result<bool, AppError> {
        self.database
            .with_connection(|connection| {
                connection.execute("DELETE FROM download_history WHERE task_id = ?1", [task_id])
            })
            .map(|changed| changed > 0)
    }
}

fn history_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadHistoryRecord> {
    let paths_json: String = row.get(2)?;
    let output_paths = serde_json::from_str(&paths_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(DownloadHistoryRecord {
        task_id: row.get(0)?,
        title: row.get(1)?,
        output_paths,
        total_bytes: from_sql_integer(row.get(3)?)?,
        completed_at_unix_ms: from_sql_integer(row.get(4)?)?,
    })
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<(DownloadTask, DownloadOptions)> {
    let subtitle_json: String = row.get(5)?;
    let subtitles = serde_json::from_str(&subtitle_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            subtitle_json.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;
    let created_at: i64 = row.get(8)?;
    Ok((
        DownloadTask {
            id: row.get(0)?,
            url: row.get(1)?,
            title: row.get(2)?,
            format_id: row.get(3)?,
            status: parse_status(&row.get::<_, String>(7)?)?,
            created_at_unix_ms: from_sql_integer(created_at)?,
        },
        DownloadOptions {
            url: row.get(1)?,
            title: row.get(2)?,
            format_id: row.get(3)?,
            output_directory: row.get(4)?,
            merge_container: row
                .get::<_, Option<String>>(18)?
                .map(|value| {
                    serde_json::from_value(serde_json::Value::String(value))
                        .map_err(|_| rusqlite::Error::InvalidQuery)
                })
                .transpose()?,
            subtitle_languages: subtitles,
            conflict_strategy: parse_conflict_strategy(&row.get::<_, String>(6)?)?,
            playlist_item_count: row.get(9)?,
            playlist_items: row
                .get::<_, Option<String>>(20)?
                .map(|value| {
                    serde_json::from_str(&value).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            20,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    })
                })
                .transpose()?,
            audio_only: row.get(10)?,
            write_automatic_subtitles: row.get(11)?,
            write_thumbnail: row.get(12)?,
            write_info_json: row.get(13)?,
            embed_metadata: row.get(14)?,
            keep_intermediate_files: row.get(19)?,
            cookies_file_path: row.get(15)?,
            cookies_browser: row
                .get::<_, Option<String>>(16)?
                .as_deref()
                .and_then(CookieBrowser::from_yt_dlp_name),
            cookie_access_confirmed: row.get(17)?,
        },
    ))
}

fn conflict_strategy_name(strategy: DownloadConflictStrategy) -> &'static str {
    match strategy {
        DownloadConflictStrategy::Skip => "skip",
        DownloadConflictStrategy::Overwrite => "overwrite",
    }
}

fn parse_conflict_strategy(value: &str) -> rusqlite::Result<DownloadConflictStrategy> {
    match value {
        "skip" => Ok(DownloadConflictStrategy::Skip),
        "overwrite" => Ok(DownloadConflictStrategy::Overwrite),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn status_name(status: DownloadTaskStatus) -> &'static str {
    match status {
        DownloadTaskStatus::Queued => "queued",
        DownloadTaskStatus::Preparing => "preparing",
        DownloadTaskStatus::Downloading => "downloading",
        DownloadTaskStatus::PostProcessing => "post_processing",
        DownloadTaskStatus::Completed => "completed",
        DownloadTaskStatus::Failed => "failed",
        DownloadTaskStatus::Cancelling => "cancelling",
        DownloadTaskStatus::Cancelled => "cancelled",
    }
}

fn parse_status(status: &str) -> rusqlite::Result<DownloadTaskStatus> {
    match status {
        "queued" => Ok(DownloadTaskStatus::Queued),
        "preparing" => Ok(DownloadTaskStatus::Preparing),
        "downloading" => Ok(DownloadTaskStatus::Downloading),
        "post_processing" => Ok(DownloadTaskStatus::PostProcessing),
        "completed" => Ok(DownloadTaskStatus::Completed),
        "failed" => Ok(DownloadTaskStatus::Failed),
        "cancelling" => Ok(DownloadTaskStatus::Cancelling),
        "cancelled" => Ok(DownloadTaskStatus::Cancelled),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn validate_setting_key(key: &str) -> Result<(), AppError> {
    let valid = !key.trim().is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(AppError::new(
            ErrorCode::InvalidPath,
            "设置键格式无效。",
            false,
        ))
    }
}

fn to_sql_integer(value: u64) -> Result<i64, AppError> {
    i64::try_from(value)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "本地数据超出支持范围。", false))
}

fn from_sql_integer(value: i64) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|_| rusqlite::Error::InvalidQuery)
}

#[cfg(test)]
mod tests {
    use crate::{
        domain::download::{
            CookieBrowser, DownloadConflictStrategy, DownloadOptions, DownloadResult,
            DownloadTaskStatus,
        },
        infrastructure::database::Database,
    };

    use super::{DownloadTaskRepository, HistoryRepository, SettingsRepository};

    fn repositories() -> (
        SettingsRepository,
        DownloadTaskRepository,
        HistoryRepository,
    ) {
        let database = Database::open_in_memory().expect("database should open");
        (
            SettingsRepository::new(database.clone()),
            DownloadTaskRepository::new(database.clone()),
            HistoryRepository::new(database),
        )
    }

    #[test]
    fn settings_round_trip_json_and_validate_keys() {
        let (settings, _, _) = repositories();
        settings
            .set("download.directory", &"/tmp/videos", 100)
            .expect("setting should save");
        let value: Option<String> = settings.get("download.directory").expect("setting reads");
        assert_eq!(value.as_deref(), Some("/tmp/videos"));
        assert!(settings.set("bad key", &true, 101).is_err());
        assert!(
            settings
                .remove("download.directory")
                .expect("remove should work")
        );
        let removed: Option<String> = settings.get("download.directory").expect("lookup works");
        assert_eq!(removed, None);
    }

    #[test]
    fn settings_survive_database_reopen() {
        let path = std::env::temp_dir().join(format!(
            "savebeam-settings-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let database = Database::open(&path).unwrap();
        SettingsRepository::new(database)
            .set("download.preferences", &"persisted", 10)
            .unwrap();
        let reopened = Database::open(&path).unwrap();
        let value: Option<String> = SettingsRepository::new(reopened)
            .get("download.preferences")
            .unwrap();
        assert_eq!(value.as_deref(), Some("persisted"));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }

    #[test]
    fn task_repository_round_trips_options_and_updates_state() {
        let (_, tasks, _) = repositories();
        let task = crate::domain::download::DownloadTask {
            id: "task-1".into(),
            url: "https://example.com/watch/1".into(),
            title: "Example".into(),
            format_id: "18".into(),
            status: DownloadTaskStatus::Queued,
            created_at_unix_ms: 100,
        };
        let options = DownloadOptions {
            title: task.title.clone(),
            url: task.url.clone(),
            format_id: task.format_id.clone(),
            output_directory: "/tmp/videos".into(),
            merge_container: Some(crate::domain::download::MergeContainer::Mkv),
            subtitle_languages: vec!["en".into()],
            conflict_strategy: DownloadConflictStrategy::Overwrite,
            playlist_item_count: Some(3),
            playlist_items: Some(vec![1, 3, 5]),
            audio_only: true,
            write_automatic_subtitles: true,
            write_thumbnail: true,
            write_info_json: true,
            embed_metadata: true,
            keep_intermediate_files: true,
            cookies_file_path: None,
            cookies_browser: Some(CookieBrowser::Firefox),
            cookie_access_confirmed: true,
        };
        tasks.insert(&task, &options).expect("task should persist");
        assert!(
            tasks
                .update_status(&task.id, DownloadTaskStatus::Downloading, 200)
                .expect("status updates")
        );
        let (loaded, loaded_options) = tasks
            .get(&task.id)
            .expect("query works")
            .expect("task exists");
        assert_eq!(loaded.status, DownloadTaskStatus::Downloading);
        assert_eq!(loaded_options.subtitle_languages, ["en"]);
        assert_eq!(
            loaded_options.conflict_strategy,
            DownloadConflictStrategy::Overwrite
        );
        assert_eq!(loaded_options.playlist_item_count, Some(3));
        assert_eq!(loaded_options.playlist_items, Some(vec![1, 3, 5]));
        assert!(loaded_options.audio_only);
        assert!(loaded_options.write_automatic_subtitles);
        assert!(loaded_options.write_thumbnail);
        assert!(loaded_options.write_info_json);
        assert!(loaded_options.embed_metadata);
        assert!(loaded_options.keep_intermediate_files);
        assert_eq!(loaded_options.cookies_file_path, None);
        assert_eq!(loaded_options.cookies_browser, Some(CookieBrowser::Firefox));
        assert!(loaded_options.cookie_access_confirmed);
        assert_eq!(loaded_options.merge_container, options.merge_container);
        assert_eq!(tasks.list().expect("list works").len(), 1);
    }

    #[test]
    fn deleting_history_does_not_touch_download_files_or_task_record() {
        let (_, tasks, history) = repositories();
        let task = crate::domain::download::DownloadTask {
            id: "task-history".into(),
            url: "https://example.com/watch/1".into(),
            title: "Example".into(),
            format_id: "18".into(),
            status: DownloadTaskStatus::Completed,
            created_at_unix_ms: 100,
        };
        let options = DownloadOptions {
            title: task.title.clone(),
            url: task.url.clone(),
            format_id: task.format_id.clone(),
            output_directory: "/tmp".into(),
            merge_container: None,
            subtitle_languages: Vec::new(),
            conflict_strategy: DownloadConflictStrategy::Skip,
            playlist_item_count: None,
            playlist_items: None,
            audio_only: false,
            write_automatic_subtitles: false,
            write_thumbnail: false,
            write_info_json: false,
            embed_metadata: false,
            keep_intermediate_files: false,
            cookies_file_path: None,
            cookies_browser: None,
            cookie_access_confirmed: false,
        };
        tasks.insert(&task, &options).expect("task should persist");
        let result = DownloadResult {
            task_id: task.id.clone(),
            title: task.title.clone(),
            output_paths: vec!["/tmp/example.mp4".into()],
            total_bytes: 10,
        };
        history
            .insert(&result, 300)
            .expect("history should persist");
        assert_eq!(history.list().expect("history lists").len(), 1);
        assert_eq!(history.search("Example").unwrap().len(), 1);
        assert!(history.search("not found").unwrap().is_empty());
        assert!(history.delete(&task.id).expect("history deletes"));
        assert!(history.list().expect("history lists").is_empty());
        assert!(tasks.get(&task.id).expect("task lookup works").is_some());
        assert!(!history.delete("missing").expect("missing delete is okay"));
    }
}
