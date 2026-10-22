//! Local SQLite storage with explicit, versioned schema migrations.

use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use rusqlite::{Connection, TransactionBehavior};

use crate::domain::error::{AppError, ErrorCode};

pub const CURRENT_SCHEMA_VERSION: u32 = 11;

pub mod repositories;
pub mod subscriptions;

const MIGRATIONS: &[(u32, &str)] = &[(
    1,
    "CREATE TABLE app_settings (
         setting_key TEXT PRIMARY KEY NOT NULL,
         value_json TEXT NOT NULL,
         updated_at_unix_ms INTEGER NOT NULL
     );
     CREATE TABLE download_tasks (
         task_id TEXT PRIMARY KEY NOT NULL,
         url TEXT NOT NULL,
         title TEXT NOT NULL,
         format_id TEXT NOT NULL,
         output_directory TEXT NOT NULL,
         subtitle_languages_json TEXT NOT NULL DEFAULT '[]',
         status TEXT NOT NULL,
         created_at_unix_ms INTEGER NOT NULL,
         updated_at_unix_ms INTEGER NOT NULL
     );
     CREATE TABLE download_history (
         task_id TEXT PRIMARY KEY NOT NULL REFERENCES download_tasks(task_id) ON DELETE CASCADE,
         output_paths_json TEXT NOT NULL,
         total_bytes INTEGER NOT NULL,
         completed_at_unix_ms INTEGER NOT NULL
     );
     CREATE INDEX download_tasks_created_at_idx ON download_tasks(created_at_unix_ms DESC);
     CREATE INDEX download_history_completed_at_idx ON download_history(completed_at_unix_ms DESC);",
), (2,
    "ALTER TABLE download_tasks ADD COLUMN conflict_strategy TEXT NOT NULL DEFAULT 'skip';"
), (3,
    "ALTER TABLE download_tasks ADD COLUMN playlist_item_count INTEGER;"
), (4,
    "ALTER TABLE download_tasks ADD COLUMN audio_only INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE download_tasks ADD COLUMN write_automatic_subtitles INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE download_tasks ADD COLUMN write_thumbnail INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE download_tasks ADD COLUMN write_info_json INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE download_tasks ADD COLUMN embed_metadata INTEGER NOT NULL DEFAULT 0;"
), (5,
    "ALTER TABLE download_tasks ADD COLUMN cookies_file_path TEXT;
     ALTER TABLE download_tasks ADD COLUMN cookies_browser TEXT;
     ALTER TABLE download_tasks ADD COLUMN cookie_access_confirmed INTEGER NOT NULL DEFAULT 0;"
), (6,
    "ALTER TABLE download_tasks ADD COLUMN merge_container TEXT;"
), (7,
    "ALTER TABLE download_tasks ADD COLUMN keep_intermediate_files INTEGER NOT NULL DEFAULT 0;"
), (8,
    "ALTER TABLE download_tasks ADD COLUMN playlist_items_json TEXT;"
) , (9,
    "ALTER TABLE download_tasks ADD COLUMN expected_media_id TEXT;
     CREATE INDEX download_tasks_subscription_idx ON download_tasks(url, expected_media_id, created_at_unix_ms);
     CREATE TABLE subscriptions (
         subscription_id INTEGER PRIMARY KEY AUTOINCREMENT,
         url TEXT NOT NULL UNIQUE,
         source_id TEXT NOT NULL,
         title TEXT NOT NULL,
         last_checked_unix_ms INTEGER NOT NULL,
         truncated INTEGER NOT NULL DEFAULT 0
     );
     CREATE TABLE subscription_entries (
         subscription_id INTEGER NOT NULL REFERENCES subscriptions(subscription_id) ON DELETE CASCADE,
         media_id TEXT NOT NULL,
         position INTEGER NOT NULL,
         title TEXT NOT NULL,
         downloaded INTEGER NOT NULL DEFAULT 0,
         is_new INTEGER NOT NULL DEFAULT 0,
         available INTEGER NOT NULL DEFAULT 1,
         PRIMARY KEY(subscription_id, media_id)
     );
     CREATE TABLE downloaded_media (
         source_url TEXT NOT NULL,
         media_id TEXT NOT NULL,
         PRIMARY KEY(source_url, media_id)
     );"
) , (10,
    "ALTER TABLE download_tasks ADD COLUMN hidden_from_tasks INTEGER NOT NULL DEFAULT 0;"
) , (11,
    "ALTER TABLE download_tasks ADD COLUMN use_proxy INTEGER CHECK (use_proxy IN (0, 1));"
)];

#[derive(Debug, Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let connection = Connection::open(path).map_err(storage_error)?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(storage_error)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(storage_error)?;
        Self::from_connection(connection)
    }

    pub fn open_in_memory() -> Result<Self, AppError> {
        Self::from_connection(Connection::open_in_memory().map_err(storage_error)?)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, AppError> {
        migrate(&mut connection).map_err(storage_error)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, AppError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "本地数据库暂时不可用。", true))?;
        operation(&connection).map_err(storage_error)
    }

    pub fn schema_version(&self) -> Result<u32, AppError> {
        self.with_connection(|connection| {
            connection.pragma_query_value(None, "user_version", |row| row.get(0))
        })
    }
}

#[derive(Debug, Default)]
pub struct DatabaseManager {
    database: Mutex<Option<Database>>,
    initialization_error: Mutex<Option<AppError>>,
}

impl DatabaseManager {
    pub fn initialize(&self, path: impl AsRef<Path>) {
        let path = path.as_ref();
        let initialized = (|| {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    AppError::new(ErrorCode::InvalidPath, "无法创建应用数据目录。", false)
                        .with_diagnostic(error.to_string())
                })?;
            }
            Database::open(path)
        })();
        match initialized {
            Ok(database) => {
                if let Ok(mut slot) = self.database.lock() {
                    *slot = Some(database);
                }
            }
            Err(error) => {
                if let Ok(mut slot) = self.initialization_error.lock() {
                    *slot = Some(error);
                }
            }
        }
    }

    pub fn database(&self) -> Result<Database, AppError> {
        if let Some(database) = self
            .database
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "本地数据库暂时不可用。", true))?
            .as_ref()
        {
            return Ok(database.clone());
        }
        Err(self
            .initialization_error
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "本地数据库暂时不可用。", true))?
            .clone()
            .unwrap_or_else(|| AppError::new(ErrorCode::Unknown, "本地数据库尚未初始化。", false)))
    }
}

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let current_version: u32 =
        connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if current_version > CURRENT_SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }

    for (version, sql) in MIGRATIONS
        .iter()
        .filter(|(version, _)| *version > current_version)
    {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute_batch(sql)?;
        transaction.pragma_update(None, "user_version", version)?;
        transaction.commit()?;
    }
    Ok(())
}

pub(crate) fn storage_error(error: rusqlite::Error) -> AppError {
    AppError::new(
        ErrorCode::Unknown,
        "本地数据库无法打开或迁移失败，应用仍可启动，但本地设置与历史暂不可用。",
        false,
    )
    .with_diagnostic(error.to_string())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::{CURRENT_SCHEMA_VERSION, Database, DatabaseManager, migrate};

    #[test]
    fn creates_schema_with_all_initial_tables_and_version() {
        let database = Database::open_in_memory().expect("database should initialize");
        let version = database
            .schema_version()
            .expect("schema version should be readable");
        let table_count: i64 = database
            .with_connection(|connection| {
                connection.query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('app_settings', 'download_tasks', 'download_history')",
                    [],
                    |row| row.get(0),
                )
            })
            .expect("initial tables should exist");

        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        assert_eq!(table_count, 3);
    }

    #[test]
    fn opening_a_file_database_runs_migrations_idempotently() {
        let path = std::env::temp_dir().join(format!(
            "savebeam-database-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        let first = Database::open(&path).expect("database should open");
        let second = Database::open(&path).expect("database should re-open");
        assert_eq!(
            first.schema_version().expect("version exists"),
            CURRENT_SCHEMA_VERSION
        );
        assert_eq!(
            second.schema_version().expect("version persists"),
            CURRENT_SCHEMA_VERSION
        );
        drop(first);
        drop(second);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }

    #[test]
    fn upgrades_a_version_one_database_without_losing_task_rows() {
        #[derive(Debug, PartialEq, Eq)]
        struct MigratedTask {
            task_id: String,
            conflict_strategy: String,
            playlist_item_count: Option<i64>,
            audio_only: bool,
            write_automatic_subtitles: bool,
            write_thumbnail: bool,
            write_info_json: bool,
            embed_metadata: bool,
            cookies_file_path: Option<String>,
            cookies_browser: Option<String>,
            cookie_access_confirmed: bool,
            merge_container: Option<String>,
            keep_intermediate_files: bool,
            playlist_items_json: Option<String>,
        }

        let mut connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE download_tasks (
                    task_id TEXT PRIMARY KEY NOT NULL,
                    url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    format_id TEXT NOT NULL,
                    output_directory TEXT NOT NULL,
                    subtitle_languages_json TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL,
                    created_at_unix_ms INTEGER NOT NULL,
                    updated_at_unix_ms INTEGER NOT NULL
                );
                INSERT INTO download_tasks VALUES
                    ('old-task', 'https://example.com/video', 'Old', '18', '/tmp', '[]', 'completed', 10, 10);
                PRAGMA user_version = 1;",
            )
            .unwrap();

        migrate(&mut connection).expect("v1 database should migrate to current version");
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        let migrated: MigratedTask = connection
            .query_row(
                "SELECT task_id, conflict_strategy, playlist_item_count, audio_only,
                        write_automatic_subtitles, write_thumbnail, write_info_json, embed_metadata,
                        cookies_file_path, cookies_browser, cookie_access_confirmed, merge_container,
                        keep_intermediate_files, playlist_items_json
                 FROM download_tasks WHERE task_id = 'old-task'",
                [],
                |row| {
                    Ok(MigratedTask {
                        task_id: row.get(0)?,
                        conflict_strategy: row.get(1)?,
                        playlist_item_count: row.get(2)?,
                        audio_only: row.get(3)?,
                        write_automatic_subtitles: row.get(4)?,
                        write_thumbnail: row.get(5)?,
                        write_info_json: row.get(6)?,
                        embed_metadata: row.get(7)?,
                        cookies_file_path: row.get(8)?,
                        cookies_browser: row.get(9)?,
                        cookie_access_confirmed: row.get(10)?,
                        merge_container: row.get(11)?,
                        keep_intermediate_files: row.get(12)?,
                        playlist_items_json: row.get(13)?,
                    })
                },
            )
            .unwrap();

        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        let legacy_proxy: Option<bool> = connection
            .query_row(
                "SELECT use_proxy FROM download_tasks WHERE task_id = 'old-task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            legacy_proxy, None,
            "old tasks retain their inherited network behavior"
        );
        assert_eq!(
            migrated,
            MigratedTask {
                task_id: "old-task".into(),
                conflict_strategy: "skip".into(),
                playlist_item_count: None,
                audio_only: false,
                write_automatic_subtitles: false,
                write_thumbnail: false,
                write_info_json: false,
                embed_metadata: false,
                cookies_file_path: None,
                cookies_browser: None,
                cookie_access_confirmed: false,
                merge_container: None,
                keep_intermediate_files: false,
                playlist_items_json: None,
            }
        );
    }

    #[test]
    fn database_manager_keeps_corruption_as_a_recoverable_error() {
        let manager = DatabaseManager::default();
        let path = std::env::temp_dir().join(format!(
            "savebeam-invalid-db-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        std::fs::write(&path, b"not a sqlite database")
            .expect("invalid db fixture should be written");
        manager.initialize(&path);
        let error = manager
            .database()
            .expect_err("corrupt database should be reported");
        assert!(error.message.contains("应用仍可启动"));
        let _ = std::fs::remove_file(path);
    }
}
