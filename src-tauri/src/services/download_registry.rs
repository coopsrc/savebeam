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
        download::{DownloadTask, DownloadTaskStatus},
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
    cancellations: HashMap<String, CancellationToken>,
}

impl DownloadTaskRegistry {
    pub fn create(
        &self,
        url: String,
        title: String,
        format_id: String,
    ) -> Result<DownloadTask, AppError> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))?
            .as_millis() as u64;
        let sequence = NEXT_TASK_ID.fetch_add(1, Ordering::Relaxed);
        let task = DownloadTask {
            id: format!("{timestamp}-{sequence}"),
            url,
            title,
            format_id,
            status: DownloadTaskStatus::Queued,
            created_at_unix_ms: timestamp,
        };
        let mut state = self.lock()?;
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
    use crate::domain::download::DownloadTaskStatus;

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
            .create("https://example.com/1".into(), "First".into(), "18".into())
            .expect("task should be created");
        let second = registry
            .create("https://example.com/2".into(), "Second".into(), "22".into())
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
            .create("https://example.com/1".into(), "First".into(), "18".into())
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
}
