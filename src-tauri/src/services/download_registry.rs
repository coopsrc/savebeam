//! In-memory download task state and cancellation registry.

use std::{
    collections::HashMap,
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
};

static NEXT_TASK_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Default)]
pub struct DownloadTaskRegistry {
    inner: Arc<Mutex<RegistryState>>,
}

#[derive(Debug, Default)]
struct RegistryState {
    tasks: HashMap<String, DownloadTask>,
    options: HashMap<String, DownloadOptions>,
    cancellations: HashMap<String, CancellationToken>,
}

impl DownloadTaskRegistry {
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
        Ok(task.clone())
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

    pub fn cancel(&self, task_id: &str) -> Result<DownloadTask, AppError> {
        let mut state = self.lock()?;
        let cancellation = state.cancellations.get(task_id).cloned();
        let task = state
            .tasks
            .get_mut(task_id)
            .ok_or_else(|| AppError::new(ErrorCode::Unknown, "找不到下载任务。", false))?;
        match task.status {
            DownloadTaskStatus::Queued => {
                task.status = DownloadTaskStatus::Cancelled;
                if let Some(token) = cancellation.as_ref() {
                    token.cancel();
                }
            }
            DownloadTaskStatus::Preparing
            | DownloadTaskStatus::Downloading
            | DownloadTaskStatus::PostProcessing => {
                task.status = DownloadTaskStatus::Cancelling;
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
        state
            .cancellations
            .insert(task_id.to_owned(), CancellationToken::default());
        Ok((task, options))
    }

    pub fn cancel_all(&self) -> Result<Vec<DownloadTask>, AppError> {
        let mut state = self.lock()?;
        let mut changed = Vec::new();
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

    fn test_options(url: &str, title: &str, format_id: &str) -> DownloadOptions {
        DownloadOptions {
            title: title.to_owned(),
            url: url.to_owned(),
            format_id: format_id.to_owned(),
            output_directory: "/tmp".into(),
            subtitle_languages: Vec::new(),
        }
    }
}
