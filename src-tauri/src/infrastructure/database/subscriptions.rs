//! Local subscriptions and ID-based completion ledger, independent of history deletion.
use rusqlite::{OptionalExtension, params};
use serde::Serialize;

use super::Database;
use crate::domain::error::{AppError, ErrorCode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionEntry {
    pub id: String,
    pub index: u32,
    pub title: String,
    pub downloaded: bool,
    pub is_new: bool,
    pub available: bool,
    pub task_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub id: i64,
    pub url: String,
    pub source_id: String,
    pub title: String,
    pub last_checked_unix_ms: u64,
    pub truncated: bool,
    pub entries: Vec<SubscriptionEntry>,
}

pub struct SeriesSnapshot {
    pub source_id: String,
    pub title: String,
    pub truncated: bool,
    pub entries: Vec<SubscriptionEntry>,
}

#[derive(Clone)]
pub struct SubscriptionRepository(pub Database);

impl SubscriptionRepository {
    pub fn list(&self) -> Result<Vec<Subscription>, AppError> {
        self.0.with_connection(|connection| {
            let mut statement = connection.prepare("SELECT subscription_id, url, source_id, title, last_checked_unix_ms, truncated FROM subscriptions ORDER BY subscription_id DESC")?;
            let mut subscriptions = statement.query_map([], |row| Ok(Subscription {
                id: row.get(0)?, url: row.get(1)?, source_id: row.get(2)?, title: row.get(3)?,
                last_checked_unix_ms: row.get::<_, i64>(4)? as u64, truncated: row.get(5)?, entries: Vec::new(),
            }))?.collect::<rusqlite::Result<Vec<_>>>()?;
            for subscription in &mut subscriptions {
                let mut entries = connection.prepare("SELECT e.media_id, e.position, e.title, e.downloaded, e.is_new, e.available,
                    (SELECT t.status FROM download_tasks t WHERE t.url = ?2 AND t.expected_media_id = e.media_id ORDER BY t.created_at_unix_ms DESC, t.rowid DESC LIMIT 1)
                    FROM subscription_entries e WHERE e.subscription_id = ?1 ORDER BY e.position, e.media_id")?;
                subscription.entries = entries.query_map(params![subscription.id, subscription.url], |row| Ok(SubscriptionEntry {
                    id: row.get(0)?, index: row.get(1)?, title: row.get(2)?, downloaded: row.get(3)?,
                    is_new: row.get(4)?, available: row.get(5)?, task_status: row.get(6)?,
                }))?.collect::<rusqlite::Result<Vec<_>>>()?;
            }
            Ok(subscriptions)
        })
    }

    pub fn get(&self, id: i64) -> Result<Subscription, AppError> {
        self.list()?
            .into_iter()
            .find(|item| item.id == id)
            .ok_or_else(|| {
                AppError::new(ErrorCode::InvalidUrl, "找不到订阅，可能已经取消。", false)
            })
    }

    /// Atomic snapshot replacement. Reordering is not an update; failed checks never call this.
    pub fn apply(
        &self,
        url: &str,
        snapshot: &SeriesSnapshot,
        checked_at: u64,
    ) -> Result<i64, AppError> {
        let checked_at = i64::try_from(checked_at)
            .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间超出范围。", false))?;
        self.0.with_connection(|connection| {
            let tx = connection.unchecked_transaction()?;
            let existing: Option<(i64, String)> = tx.query_row("SELECT subscription_id, source_id FROM subscriptions WHERE url = ?1", [url], |row| Ok((row.get(0)?, row.get(1)?))).optional()?;
            let initial = existing.is_none();
            let id = if let Some((id, source_id)) = existing {
                if source_id != snapshot.source_id { return Err(rusqlite::Error::InvalidQuery); }
                tx.execute("UPDATE subscriptions SET title = ?2, last_checked_unix_ms = ?3, truncated = ?4 WHERE subscription_id = ?1", params![id, snapshot.title, checked_at, snapshot.truncated])?;
                id
            } else {
                let count: i64 = tx.query_row("SELECT COUNT(*) FROM subscriptions", [], |row| row.get(0))?;
                if count >= 100 { return Err(rusqlite::Error::InvalidQuery); }
                tx.execute("INSERT INTO subscriptions(url, source_id, title, last_checked_unix_ms, truncated) VALUES (?1, ?2, ?3, ?4, ?5)", params![url, snapshot.source_id, snapshot.title, checked_at, snapshot.truncated])?;
                tx.last_insert_rowid()
            };
            // A partial scan must not declare unobserved entries deleted.
            if !snapshot.truncated { tx.execute("UPDATE subscription_entries SET available = 0 WHERE subscription_id = ?1", [id])?; }
            for entry in &snapshot.entries {
                tx.execute("INSERT INTO subscription_entries(subscription_id, media_id, position, title, downloaded, is_new, available)
                    VALUES (?1, ?2, ?3, ?4, EXISTS(SELECT 1 FROM downloaded_media WHERE source_url = ?5 AND media_id = ?2), ?6, ?7)
                    ON CONFLICT(subscription_id, media_id) DO UPDATE SET position = excluded.position, title = excluded.title, available = excluded.available,
                        downloaded = MAX(subscription_entries.downloaded, excluded.downloaded)",
                    params![id, entry.id, entry.index, entry.title, url, !initial, entry.available])?;
            }
            tx.commit()?;
            Ok(id)
        })
    }

    pub fn mark_downloaded(&self, url: &str, ids: &[String]) -> Result<(), AppError> {
        self.0.with_connection(|connection| {
            let tx = connection.unchecked_transaction()?;
            for id in ids {
                tx.execute("INSERT OR IGNORE INTO downloaded_media(source_url, media_id) VALUES (?1, ?2)", params![url, id])?;
                tx.execute("UPDATE subscription_entries SET downloaded = 1 WHERE media_id = ?2 AND subscription_id IN (SELECT subscription_id FROM subscriptions WHERE url = ?1)", params![url, id])?;
            }
            tx.commit()
        })
    }

    pub fn delete(&self, id: i64) -> Result<(), AppError> {
        self.0.with_connection(|connection| {
            connection.execute("DELETE FROM subscriptions WHERE subscription_id = ?1", [id])
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::download::{DownloadOptions, DownloadTask, DownloadTaskStatus},
        infrastructure::database::repositories::DownloadTaskRepository,
    };

    fn snapshot(ids: &[&str]) -> SeriesSnapshot {
        SeriesSnapshot {
            source_id: "fixture:list".into(),
            title: "课程".into(),
            truncated: false,
            entries: ids
                .iter()
                .enumerate()
                .map(|(offset, id)| SubscriptionEntry {
                    id: (*id).into(),
                    index: (offset + 1) as u32,
                    title: (*id).into(),
                    downloaded: false,
                    is_new: false,
                    available: true,
                    task_status: None,
                })
                .collect(),
        }
    }

    #[test]
    fn baseline_reorder_updates_completion_and_unsubscribe_have_separate_meanings() {
        let database = Database::open_in_memory().unwrap();
        let repo = SubscriptionRepository(database.clone());
        let url = "https://example.com/list";
        repo.mark_downloaded(url, &["a".into()]).unwrap();
        let id = repo.apply(url, &snapshot(&["a", "b"]), 100).unwrap();
        let initial = repo.get(id).unwrap();
        assert!(initial.entries[0].downloaded);
        assert!(!initial.entries[1].downloaded);
        assert!(initial.entries.iter().all(|entry| !entry.is_new));
        assert_eq!(
            repo.apply(url, &snapshot(&["b", "a", "c"]), 200).unwrap(),
            id
        );
        let updated = repo.get(id).unwrap();
        assert_eq!(updated.entries[0].id, "b");
        assert!(updated.entries[1].downloaded);
        assert_eq!(
            updated
                .entries
                .iter()
                .filter(|entry| entry.is_new)
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["c"]
        );
        repo.mark_downloaded(url, &["c".into()]).unwrap();
        repo.apply(url, &snapshot(&["c", "b"]), 300).unwrap();
        assert!(
            !repo
                .get(id)
                .unwrap()
                .entries
                .iter()
                .find(|entry| entry.id == "a")
                .unwrap()
                .available
        );
        repo.delete(id).unwrap();
        assert!(repo.list().unwrap().is_empty());
        let id = repo.apply(url, &snapshot(&["c"]), 400).unwrap();
        assert!(repo.get(id).unwrap().entries[0].downloaded);
    }

    #[test]
    fn incomplete_scans_and_identity_errors_preserve_the_previous_state() {
        let repo = SubscriptionRepository(Database::open_in_memory().unwrap());
        let url = "https://example.com/list";
        let id = repo.apply(url, &snapshot(&["a", "b"]), 100).unwrap();
        let mut partial = snapshot(&["b"]);
        partial.truncated = true;
        repo.apply(url, &partial, 200).unwrap();
        assert!(
            repo.get(id)
                .unwrap()
                .entries
                .iter()
                .all(|entry| entry.available)
        );
        partial.source_id = "other:list".into();
        assert!(repo.apply(url, &partial, 300).is_err());
        assert_eq!(repo.get(id).unwrap().last_checked_unix_ms, 200);
    }

    #[test]
    fn queued_and_failed_tasks_do_not_mark_entries_downloaded_and_guard_survives_reload() {
        let database = Database::open_in_memory().unwrap();
        let repo = SubscriptionRepository(database.clone());
        let tasks = DownloadTaskRepository::new(database);
        let url = "https://example.com/list";
        let id = repo.apply(url, &snapshot(&["a"]), 100).unwrap();
        let task = DownloadTask {
            id: "test-task".into(),
            url: url.into(),
            title: "A".into(),
            format_id: "bestvideo+bestaudio/best".into(),
            status: DownloadTaskStatus::Queued,
            created_at_unix_ms: 100,
        };
        let options = DownloadOptions {
            url: url.into(),
            expected_media_id: Some("a".into()),
            playlist_item_count: Some(1),
            playlist_items: Some(vec![999]),
            ..Default::default()
        };
        tasks.insert(&task, &options).unwrap();
        assert_eq!(
            repo.get(id).unwrap().entries[0].task_status.as_deref(),
            Some("queued")
        );
        assert!(!repo.get(id).unwrap().entries[0].downloaded);
        tasks
            .update_status(&task.id, DownloadTaskStatus::Failed, 200)
            .unwrap();
        assert!(!repo.get(id).unwrap().entries[0].downloaded);
        let restored = tasks.get(&task.id).unwrap().unwrap().1;
        assert_eq!(restored.expected_media_id.as_deref(), Some("a"));
        assert_eq!(restored.playlist_items, Some(vec![999]));
    }
}
