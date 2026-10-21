//! In-memory download task state and cancellation registry.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    domain::{
        download::{DownloadOptions, DownloadTask, DownloadTaskStatus},
        error::{AppError, ErrorCode},
    },
    infrastructure::ytdlp_process::CancellationToken,
    infrastructure::{database::Database, database::repositories::DownloadTaskRepository},
};

static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct DownloadTaskRegistry {
    inner: Arc<Mutex<RegistryState>>,
}

#[derive(Debug)]
struct RegistryState {
    tasks: HashMap<String, DownloadTask>,
    options: HashMap<String, DownloadOptions>,
    cancellations: HashMap<String, CancellationToken>,
    pending: VecDeque<String>,
    active_task_ids: HashSet<String>,
    max_concurrent: usize,
    repository: Option<DownloadTaskRepository>,
}

impl Default for RegistryState {
    fn default() -> Self {
        Self {
            tasks: HashMap::new(),
            options: HashMap::new(),
            cancellations: HashMap::new(),
            pending: VecDeque::new(),
            active_task_ids: HashSet::new(),
            max_concurrent: 1,
            repository: None,
        }
    }
}

impl Default for DownloadTaskRegistry {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryState::default())),
        }
    }
}

impl DownloadTaskRegistry {
    /// Attach durable storage and recover tasks left by the previous process.
    /// Active tasks are not resumed automatically: yt-dlp partial files remain available,
    /// and the user can explicitly retry after reviewing the interrupted task.
    pub fn initialize_from_database(&self, database: Database) -> Result<(), AppError> {
        let repository = DownloadTaskRepository::new(database);
        let records = repository.list()?;
        let mut state = self.lock()?;
        state.repository = Some(repository.clone());
        for (mut task, options) in records.into_iter().rev() {
            if matches!(
                task.status,
                DownloadTaskStatus::Preparing
                    | DownloadTaskStatus::Downloading
                    | DownloadTaskStatus::PostProcessing
                    | DownloadTaskStatus::Cancelling
            ) {
                task.status = DownloadTaskStatus::Failed;
                repository.update_status(&task.id, task.status, now_unix_ms()?)?;
            }
            if task.status == DownloadTaskStatus::Queued {
                state.pending.push_back(task.id.clone());
            }
            state.options.insert(task.id.clone(), options);
            state.tasks.insert(task.id.clone(), task.clone());
            state
                .cancellations
                .insert(task.id, CancellationToken::default());
        }
        Ok(())
    }

    pub fn create(&self, options: DownloadOptions) -> Result<DownloadTask, AppError> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))?
            .as_millis() as u64;
        let sequence = NEXT_TASK_ID.fetch_add(1, Ordering::Relaxed);
        let task = DownloadTask {
            id: format!("{timestamp}-{sequence}"),
            url: options.url.clone(),
            title: options.title.clone(),
            format_id: options.format_id.clone(),
            status: DownloadTaskStatus::Queued,
            created_at_unix_ms: timestamp,
        };
        let mut state = self.lock()?;
        if let Some(repository) = &state.repository {
            repository.insert(&task, &options)?;
        }
        state.options.insert(task.id.clone(), options);
        state.tasks.insert(task.id.clone(), task.clone());
        state
            .cancellations
            .insert(task.id.clone(), CancellationToken::default());
        Ok(task)
    }

    pub fn transition(
        &self,
        task_id: &str,
        next_status: DownloadTaskStatus,
    ) -> Result<DownloadTask, AppError> {
        let mut state = self.lock()?;
        let repository = state.repository.clone();
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))?;
        if !can_transition(task.status, next_status) {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "下载任务状态转换无效。",
                false,
            ));
        }
        task.status = next_status;
        let updated = task.clone();
        if let Some(repository) = repository {
            repository.update_status(task_id, next_status, now_unix_ms()?)?;
        }
        Ok(updated)
    }

    pub fn cancellation_token(&self, task_id: &str) -> Result<CancellationToken, AppError> {
        self.lock()?
            .cancellations
            .get(task_id)
            .cloned()
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))
    }

    pub fn task(&self, task_id: &str) -> Result<DownloadTask, AppError> {
        self.lock()?
            .tasks
            .get(task_id)
            .cloned()
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))
    }

    pub fn list(&self) -> Result<Vec<DownloadTask>, AppError> {
        let mut tasks = self.lock()?.tasks.values().cloned().collect::<Vec<_>>();
        tasks.sort_by_key(|task| std::cmp::Reverse(task.created_at_unix_ms));
        Ok(tasks)
    }

    pub fn cancel(&self, task_id: &str) -> Result<DownloadTask, AppError> {
        let mut state = self.lock()?;
        let repository = state.repository.clone();
        let cancellation = state.cancellations.get(task_id).cloned();
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))?;
        match task.status {
            DownloadTaskStatus::Queued => {
                task.status = DownloadTaskStatus::Cancelled;
                if let Some(repository) = &repository {
                    repository.update_status(task_id, task.status, now_unix_ms()?)?;
                }
                if let Some(token) = cancellation.as_ref() {
                    token.cancel();
                }
            }
            DownloadTaskStatus::Preparing
            | DownloadTaskStatus::Downloading
            | DownloadTaskStatus::PostProcessing => {
                task.status = DownloadTaskStatus::Cancelling;
                if let Some(repository) = &repository {
                    repository.update_status(task_id, task.status, now_unix_ms()?)?;
                }
                if let Some(token) = cancellation.as_ref() {
                    token.cancel();
                }
            }
            DownloadTaskStatus::Cancelling => {}
            DownloadTaskStatus::Completed
            | DownloadTaskStatus::Failed
            | DownloadTaskStatus::Cancelled => {
                return Err(AppError::new(
                    ErrorCode::Unknown,
                    "此任务当前无法取消。",
                    false,
                ));
            }
        }
        Ok(task.clone())
    }

    pub fn retry(&self, task_id: &str) -> Result<(DownloadTask, DownloadOptions), AppError> {
        let mut state = self.lock()?;
        let repository = state.repository.clone();
        let options =
            state.options.get(task_id).cloned().ok_or_else(|| {
                AppError::new(ErrorCode::Unknown, "找不到任务的下载参数。", false)
            })?;
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))?;
        if !matches!(
            task.status,
            DownloadTaskStatus::Failed | DownloadTaskStatus::Cancelled
        ) {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "只有失败或已取消的任务可以重试。",
                false,
            ));
        }
        task.status = DownloadTaskStatus::Queued;
        let task = task.clone();
        if let Some(repository) = repository {
            repository.update_status(task_id, task.status, now_unix_ms()?)?;
        }
        state
            .cancellations
            .insert(task_id.to_owned(), CancellationToken::default());
        Ok((task, options))
    }

    pub fn enqueue(&self, task_id: &str) -> Result<(), AppError> {
        let mut state = self.lock()?;
        let task = state
            .tasks
            .get(task_id)
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))?;
        if task.status != DownloadTaskStatus::Queued {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "只有排队中的任务可以加入队列。",
                false,
            ));
        }
        if !state.pending.iter().any(|pending_id| pending_id == task_id)
            && !state.active_task_ids.contains(task_id)
        {
            state.pending.push_back(task_id.to_owned());
        }
        Ok(())
    }

    pub fn claim_next(&self) -> Result<Option<(DownloadTask, DownloadOptions)>, AppError> {
        let mut state = self.lock()?;
        if state.active_task_ids.len() >= state.max_concurrent {
            return Ok(None);
        }
        while let Some(task_id) = state.pending.pop_front() {
            let Some(task) = state.tasks.get(&task_id).cloned() else {
                continue;
            };
            if task.status != DownloadTaskStatus::Queued {
                continue;
            }
            let Some(options) = state.options.get(&task_id).cloned() else {
                continue;
            };
            state.active_task_ids.insert(task_id);
            return Ok(Some((task, options)));
        }
        Ok(None)
    }

    pub fn finish(&self, task_id: &str) -> Result<bool, AppError> {
        Ok(self.lock()?.active_task_ids.remove(task_id))
    }

    pub fn set_max_concurrent(&self, limit: usize) -> Result<(), AppError> {
        if !(1..=4).contains(&limit) {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "并发任务数必须在 1 到 4 之间。",
                false,
            ));
        }
        self.lock()?.max_concurrent = limit;
        Ok(())
    }

    pub fn cancel_all(&self) -> Result<Vec<DownloadTask>, AppError> {
        let mut state = self.lock()?;
        let mut changed = Vec::new();
        let repository = state.repository.clone();
        for task in state.tasks.values_mut() {
            match task.status {
                DownloadTaskStatus::Queued => task.status = DownloadTaskStatus::Cancelled,
                DownloadTaskStatus::Preparing
                | DownloadTaskStatus::Downloading
                | DownloadTaskStatus::PostProcessing => {
                    task.status = DownloadTaskStatus::Cancelling;
                }
                _ => continue,
            }
            changed.push(task.clone());
        }
        if let Some(repository) = repository {
            for task in &changed {
                repository.update_status(&task.id, task.status, now_unix_ms()?)?;
            }
        }
        for token in state.cancellations.values() {
            token.cancel();
        }
        Ok(changed)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RegistryState>, AppError> {
        self.inner
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "下载任务状态暂时不可用。", true))
    }
}

fn now_unix_ms() -> Result<u64, AppError> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))
}

pub const fn can_transition(from: DownloadTaskStatus, to: DownloadTaskStatus) -> bool {
    use DownloadTaskStatus::*;
    matches!(
        (from, to),
        (Queued, Preparing | Cancelling | Cancelled)
            | (
                Preparing,
                Downloading | PostProcessing | Failed | Cancelling | Cancelled
            )
            | (
                Downloading,
                PostProcessing | Completed | Failed | Cancelling | Cancelled
            )
            | (PostProcessing, Completed | Failed | Cancelling | Cancelled)
            | (Cancelling, Cancelled | Failed)
            | (Failed, Queued)
            | (Cancelled, Queued)
    )
}

#[cfg(test)]
mod tests {
    use crate::domain::download::{DownloadOptions, DownloadTaskStatus};

    use super::{DownloadTaskRegistry, can_transition};

    #[test]
    fn permits_only_documented_download_task_transitions() {
        use DownloadTaskStatus::*;
        assert!(can_transition(Queued, Preparing));
        assert!(can_transition(Downloading, PostProcessing));
        assert!(can_transition(Cancelling, Cancelled));
        assert!(can_transition(Failed, Queued));
        assert!(!can_transition(Queued, Completed));
        assert!(!can_transition(Completed, Downloading));
        assert!(!can_transition(PostProcessing, Preparing));
    }

    #[test]
    fn creates_unique_queued_tasks_and_tracks_cancellation_tokens() {
        let registry = DownloadTaskRegistry::default();
        let first = registry
            .create(test_options("https://example.com/1", "First", "18"))
            .expect("task should be created");
        let second = registry
            .create(test_options("https://example.com/2", "Second", "22"))
            .expect("task should be created");

        assert_ne!(first.id, second.id);
        assert_eq!(first.status, DownloadTaskStatus::Queued);
        assert!(
            !registry
                .cancellation_token(&first.id)
                .expect("token exists")
                .is_cancelled()
        );
    }

    #[test]
    fn rejects_invalid_transitions_without_mutating_the_task() {
        let registry = DownloadTaskRegistry::default();
        let task = registry
            .create(test_options("https://example.com/1", "First", "18"))
            .expect("task should be created");
        assert!(
            registry
                .transition(&task.id, DownloadTaskStatus::Completed)
                .is_err()
        );
        let preparing = registry
            .transition(&task.id, DownloadTaskStatus::Preparing)
            .expect("queued tasks may prepare");
        assert_eq!(preparing.status, DownloadTaskStatus::Preparing);
    }

    #[test]
    fn cancels_active_tasks_and_retries_with_a_fresh_cancellation_token() {
        let registry = DownloadTaskRegistry::default();
        let task = registry
            .create(test_options("https://example.com/1", "First", "18"))
            .expect("task should be created");
        registry
            .transition(&task.id, DownloadTaskStatus::Preparing)
            .expect("task should prepare");
        let cancelling = registry.cancel(&task.id).expect("task should cancel");
        assert_eq!(cancelling.status, DownloadTaskStatus::Cancelling);
        assert!(
            registry
                .cancellation_token(&task.id)
                .expect("token exists")
                .is_cancelled()
        );
        registry
            .transition(&task.id, DownloadTaskStatus::Cancelled)
            .expect("task should finish cancellation");
        let (queued, options) = registry.retry(&task.id).expect("cancelled task retries");
        assert_eq!(queued.status, DownloadTaskStatus::Queued);
        assert_eq!(options.url, "https://example.com/1");
        assert!(
            !registry
                .cancellation_token(&task.id)
                .expect("new token exists")
                .is_cancelled()
        );
    }

    #[test]
    fn default_queue_runs_sequentially_and_advances_after_release() {
        let registry = DownloadTaskRegistry::default();
        let first = registry
            .create(test_options("https://example.com/1", "First", "18"))
            .unwrap();
        let second = registry
            .create(test_options("https://example.com/2", "Second", "22"))
            .unwrap();
        registry.enqueue(&first.id).unwrap();
        registry.enqueue(&second.id).unwrap();

        assert_eq!(registry.claim_next().unwrap().unwrap().0.id, first.id);
        assert!(registry.claim_next().unwrap().is_none());
        assert!(registry.finish(&first.id).unwrap());
        assert_eq!(registry.claim_next().unwrap().unwrap().0.id, second.id);
        assert!(!registry.finish("unknown").unwrap());
    }

    #[test]
    fn restart_recovers_queued_tasks_and_marks_interrupted_tasks_retryable() {
        use crate::{domain::download::DownloadTaskStatus, infrastructure::database::Database};

        let database = Database::open_in_memory().unwrap();
        let first_process = DownloadTaskRegistry::default();
        first_process
            .initialize_from_database(database.clone())
            .unwrap();
        let queued = first_process
            .create(test_options("https://example.com/queued", "Queued", "18"))
            .unwrap();
        let interrupted = first_process
            .create(test_options("https://example.com/active", "Active", "22"))
            .unwrap();
        first_process
            .transition(&interrupted.id, DownloadTaskStatus::Preparing)
            .unwrap();

        let second_process = DownloadTaskRegistry::default();
        second_process.initialize_from_database(database).unwrap();
        let recovered = second_process.list().unwrap();
        let recovered_queued = recovered.iter().find(|task| task.id == queued.id).unwrap();
        let recovered_interrupted = recovered
            .iter()
            .find(|task| task.id == interrupted.id)
            .unwrap();
        assert_eq!(recovered_queued.status, DownloadTaskStatus::Queued);
        assert_eq!(recovered_interrupted.status, DownloadTaskStatus::Failed);
        assert_eq!(
            second_process.claim_next().unwrap().unwrap().0.id,
            queued.id
        );
        assert!(second_process.retry(&interrupted.id).is_ok());
    }

    #[test]
    fn cancelled_queued_tasks_are_skipped_and_concurrency_is_bounded() {
        let registry = DownloadTaskRegistry::default();
        let first = registry
            .create(test_options("https://example.com/1", "First", "18"))
            .unwrap();
        let second = registry
            .create(test_options("https://example.com/2", "Second", "22"))
            .unwrap();
        registry.enqueue(&first.id).unwrap();
        registry.enqueue(&second.id).unwrap();
        registry.cancel(&first.id).unwrap();
        registry.set_max_concurrent(2).unwrap();
        assert_eq!(registry.claim_next().unwrap().unwrap().0.id, second.id);
        assert!(registry.claim_next().unwrap().is_none());
        assert!(registry.set_max_concurrent(5).is_err());
    }

    fn test_options(url: &str, title: &str, format_id: &str) -> DownloadOptions {
        DownloadOptions {
            title: title.to_owned(),
            url: url.to_owned(),
            format_id: format_id.to_owned(),
            output_directory: "/tmp".into(),
            subtitle_languages: Vec::new(),
            conflict_strategy: crate::domain::download::DownloadConflictStrategy::Skip,
            playlist_item_count: None,
        }
    }
}
