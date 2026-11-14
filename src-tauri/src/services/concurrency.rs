//! Separate metadata permits and two-level download defaults.
use crate::{
    domain::{
        download::DownloadPreferences,
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{Database, repositories::SettingsRepository},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};
use tokio::sync::Notify;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConcurrencyPreferences {
    pub metadata_total: usize,
    pub metadata_per_list: usize,
    pub download_tasks: usize,
    pub videos_per_task: u8,
}
impl Default for ConcurrencyPreferences {
    fn default() -> Self {
        Self {
            metadata_total: 4,
            metadata_per_list: 2,
            download_tasks: 2,
            videos_per_task: 2,
        }
    }
}
impl ConcurrencyPreferences {
    pub fn validate(&self) -> Result<(), AppError> {
        if !(1..=8).contains(&self.metadata_total)
            || !(1..=4).contains(&self.metadata_per_list)
            || !(1..=4).contains(&self.download_tasks)
            || !(1..=4).contains(&self.videos_per_task)
        {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "并发设置超出允许范围。",
                false,
            ));
        }
        Ok(())
    }
}
pub fn load(db: Database) -> Result<ConcurrencyPreferences, AppError> {
    let repo = SettingsRepository::new(db);
    let value = if let Some(saved) = repo.get::<ConcurrencyPreferences>("queue.preferences")? {
        saved
    } else if let Some(old) = repo.get::<DownloadPreferences>("download.preferences")? {
        ConcurrencyPreferences {
            download_tasks: old.max_concurrent,
            videos_per_task: 1,
            ..Default::default()
        }
    } else {
        ConcurrencyPreferences::default()
    };
    value.validate()?;
    Ok(value)
}

#[derive(Clone, Default)]
pub struct MetadataPool(Arc<Pool>);
#[derive(Default)]
struct Pool {
    state: Mutex<PoolState>,
    changed: Notify,
}
#[derive(Default)]
struct PoolState {
    limits: ConcurrencyPreferences,
    active: HashMap<String, usize>,
    waiting: VecDeque<(u64, String)>,
    next: u64,
}
pub struct MetadataPermit {
    pool: MetadataPool,
    owner: String,
    ticket: u64,
    running: bool,
}
impl MetadataPool {
    pub fn configure(&self, limits: ConcurrencyPreferences) -> Result<(), AppError> {
        limits.validate()?;
        self.0.state.lock().map_err(|_| unavailable())?.limits = limits;
        self.0.changed.notify_waiters();
        Ok(())
    }
    pub async fn acquire(&self, owner: String) -> Result<MetadataPermit, AppError> {
        if owner.len() > 4096 {
            return Err(unavailable());
        }
        let ticket = {
            let mut state = self.0.state.lock().map_err(|_| unavailable())?;
            state.next = state.next.wrapping_add(1);
            let ticket = state.next;
            state.waiting.push_back((ticket, owner.clone()));
            ticket
        };
        let mut permit = MetadataPermit {
            pool: self.clone(),
            owner,
            ticket,
            running: false,
        };
        loop {
            let notified = self.0.changed.notified();
            let mut notified = std::pin::pin!(notified);
            notified.as_mut().enable();
            {
                let mut state = self.0.state.lock().map_err(|_| unavailable())?;
                let total: usize = state.active.values().sum();
                // FIFO among eligible owners. A full owner's queued work never blocks others.
                let eligible = state.waiting.iter().position(|(_, owner)| {
                    state.active.get(owner).copied().unwrap_or(0) < state.limits.metadata_per_list
                });
                if total < state.limits.metadata_total
                    && eligible.is_some_and(|i| state.waiting[i].0 == ticket)
                {
                    state.waiting.remove(eligible.unwrap());
                    *state.active.entry(permit.owner.clone()).or_default() += 1;
                    permit.running = true;
                    self.0.changed.notify_waiters();
                    return Ok(permit);
                }
            }
            notified.await;
        }
    }
}
impl Drop for MetadataPermit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.pool.0.state.lock() {
            if self.running {
                if let Some(count) = state.active.get_mut(&self.owner) {
                    *count -= 1;
                    if *count == 0 {
                        state.active.remove(&self.owner);
                    }
                }
            } else {
                state.waiting.retain(|(ticket, _)| *ticket != self.ticket);
            }
        }
        self.pool.0.changed.notify_waiters();
    }
}
fn unavailable() -> AppError {
    AppError::new(ErrorCode::Unknown, "信息读取队列暂时不可用。", true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_preferences_and_invalid_saved_values_are_not_reinterpreted() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(load(db.clone()).unwrap(), ConcurrencyPreferences::default());
        let repo = SettingsRepository::new(db.clone());
        repo.set(
            "download.preferences",
            &DownloadPreferences {
                max_concurrent: 3,
                ..Default::default()
            },
            1,
        )
        .unwrap();
        let migrated = load(db.clone()).unwrap();
        assert_eq!(migrated.download_tasks, 3);
        assert_eq!(migrated.videos_per_task, 1);
        repo.set("queue.preferences", &ConcurrencyPreferences::default(), 2)
            .unwrap();
        assert_eq!(load(db.clone()).unwrap().videos_per_task, 2);
        repo.set(
            "queue.preferences",
            &ConcurrencyPreferences {
                metadata_total: 0,
                ..Default::default()
            },
            3,
        )
        .unwrap();
        assert!(load(db).is_err());
    }
    #[test]
    fn metadata_slots_are_independent_replenished_and_waiting_cancellation_releases_tickets() {
        tauri::async_runtime::block_on(async {
            use std::time::Duration;
            let pool = MetadataPool::default();
            pool.configure(ConcurrencyPreferences {
                metadata_total: 2,
                metadata_per_list: 1,
                ..Default::default()
            })
            .unwrap();
            let a = pool.acquire("A".into()).await.unwrap();
            let mut second_a = Box::pin(pool.acquire("A".into()));
            assert!(
                tokio::time::timeout(Duration::from_millis(5), &mut second_a)
                    .await
                    .is_err()
            );
            let b = pool.acquire("B".into()).await.unwrap(); // Full A cannot block B.
            let mut c = Box::pin(pool.acquire("C".into()));
            assert!(
                tokio::time::timeout(Duration::from_millis(5), &mut c)
                    .await
                    .is_err()
            );
            drop(a);
            let a = tokio::time::timeout(Duration::from_secs(1), &mut second_a)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                pool.0.state.lock().unwrap().active.values().sum::<usize>(),
                2
            );
            drop(b);
            let c = tokio::time::timeout(Duration::from_secs(1), &mut c)
                .await
                .unwrap()
                .unwrap();
            pool.configure(ConcurrencyPreferences {
                metadata_total: 1,
                metadata_per_list: 1,
                ..Default::default()
            })
            .unwrap();
            let mut d = Box::pin(pool.acquire("D".into()));
            assert!(
                tokio::time::timeout(Duration::from_millis(5), &mut d)
                    .await
                    .is_err()
            );
            drop(d);
            assert!(pool.0.state.lock().unwrap().waiting.is_empty());
            drop(a);
            drop(c);
            assert!(pool.0.state.lock().unwrap().active.is_empty());
        });
    }
}
