use crate::{
    domain::{
        error::{AppError, ErrorCode},
        source_version::{MediaVersion, SourceObservation, VersionFile},
    },
    infrastructure::database::{Database, repositories::DownloadTaskRepository},
};
use rusqlite::{OptionalExtension, params};

#[derive(Clone)]
pub struct VersionRepository(pub Database);

impl VersionRepository {
    pub fn root(&self, task_id: &str) -> Result<String, AppError> {
        let tasks = DownloadTaskRepository::new(self.0.clone());
        let mut current = task_id.to_owned();
        let mut seen = std::collections::HashSet::new();
        for _ in 0..128 {
            if !seen.insert(current.clone()) {
                break;
            }
            let (_, options) = tasks
                .get(&current)?
                .ok_or_else(|| AppError::new(ErrorCode::InvalidPath, "关联任务不存在。", false))?;
            match options.version_parent_task_id {
                Some(parent) => current = parent,
                None => return Ok(current),
            }
        }
        Err(AppError::new(
            ErrorCode::InvalidPath,
            "版本关联无效或过深。",
            false,
        ))
    }

    pub fn get(&self, task_id: &str) -> Result<Option<MediaVersion>, AppError> {
        self.0.with_connection(|c| c.query_row("SELECT task_id, root_task_id, parent_task_id, version_number, completed_at_unix_ms, source_json, files_json FROM media_versions WHERE task_id = ?1", [task_id], row).optional())
    }

    pub fn list(&self, task_id: &str) -> Result<Vec<MediaVersion>, AppError> {
        let root = self.root(task_id)?;
        self.0.with_connection(|c| {
            let mut stmt = c.prepare("SELECT task_id, root_task_id, parent_task_id, version_number, completed_at_unix_ms, source_json, files_json FROM media_versions WHERE root_task_id = ?1 ORDER BY version_number DESC")?;
            stmt.query_map([root], row)?.collect()
        })
    }

    pub fn save(
        &self,
        task_id: &str,
        source: Option<&SourceObservation>,
        files: &[VersionFile],
        completed: u64,
    ) -> Result<(), AppError> {
        let root = self.root(task_id)?;
        let (_, options) = DownloadTaskRepository::new(self.0.clone())
            .get(task_id)?
            .ok_or_else(|| AppError::new(ErrorCode::InvalidPath, "任务不存在。", false))?;
        let source = source
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| invalid())?;
        let files = serde_json::to_string(files).map_err(|_| invalid())?;
        let completed = i64::try_from(completed).map_err(|_| invalid())?;
        self.0.with_connection(|c| {
            c.execute("INSERT INTO media_versions(task_id, root_task_id, parent_task_id, version_number, completed_at_unix_ms, source_json, files_json)
             SELECT ?1, ?2, ?3, COALESCE(MAX(version_number),0)+1, ?4, ?5, ?6 FROM media_versions WHERE root_task_id=?2
             ON CONFLICT(task_id) DO UPDATE SET source_json=excluded.source_json, files_json=excluded.files_json, completed_at_unix_ms=excluded.completed_at_unix_ms",
             params![task_id, root, options.version_parent_task_id, completed, source, files])?;
            Ok(())
        })
    }
}

fn invalid() -> AppError {
    AppError::new(ErrorCode::InvalidPath, "版本信息无法安全保存。", false)
}
fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaVersion> {
    let source: Option<String> = row.get(5)?;
    let files: String = row.get(6)?;
    Ok(MediaVersion {
        task_id: row.get(0)?,
        root_task_id: row.get(1)?,
        parent_task_id: row.get(2)?,
        version_number: row.get(3)?,
        completed_at_unix_ms: u64::try_from(row.get::<_, i64>(4)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        source: source
            .map(|v| serde_json::from_str(&v))
            .transpose()
            .map_err(|_| rusqlite::Error::InvalidQuery)?,
        files: serde_json::from_str(&files).map_err(|_| rusqlite::Error::InvalidQuery)?,
    })
}
