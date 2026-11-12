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
    shutting_down: bool,
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
            shutting_down: false,
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
    /// Recover unfinished work from local files; archived rounds remain manual.
    pub fn initialize_from_database(&self, database: Database) -> Result<(), AppError> {
        let repository = DownloadTaskRepository::new(database.clone());
        let mut records = repository.list_visible()?;
        super::task_recovery::recover(&database, &mut records)?;
        let mut state = self.lock()?;
        state.repository = Some(repository.clone());
        for (task, options) in records.into_iter().rev() {
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

    pub fn create(&self, mut options: DownloadOptions) -> Result<DownloadTask, AppError> {
        options.group = super::download_groups::infer(&options);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))?
            .as_millis() as u64;
        let sequence = NEXT_TASK_ID.fetch_add(1, Ordering::Relaxed);
        let task = DownloadTask {
            format_details: options.format_details.clone(),
            batch_id: options.batch_id.clone(),
            group: options.group.clone(),
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
        // Artwork is local display data, not a repeated per-worker execution snapshot.
        options.thumbnail_data_url = None;
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
        // Process cancellation during application exit is not a user cancellation.
        // Keep the durable unfinished state for the next startup. A successful
        // completion may still commit after its verified history was saved.
        if state.shutting_down && next_status != DownloadTaskStatus::Completed {
            return Err(AppError::new(ErrorCode::Cancelled, "应用正在退出。", false));
        }
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

    /// Remove only terminal tasks from the task view; never delete history or media.
    pub fn remove(&self, task_id: &str) -> Result<bool, AppError> {
        let mut state = self.lock()?;
        let Some(task) = state.tasks.get(task_id) else {
            return Ok(false);
        };
        if !matches!(
            task.status,
            DownloadTaskStatus::Completed
                | DownloadTaskStatus::Failed
                | DownloadTaskStatus::Cancelled
        ) {
            return Err(AppError::new(
                ErrorCode::PermissionDenied,
                "运行中或排队中的任务请先取消，等待停止后再删除。",
                false,
            ));
        }
        if let Some(repository) = &state.repository
            && !repository.hide(task_id)?
        {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "任务状态发生变化，未保存删除结果；请刷新后重试。",
                true,
            ));
        }
        state.tasks.remove(task_id);
        state.options.remove(task_id);
        state.cancellations.remove(task_id);
        state.pending.retain(|id| id != task_id);
        // An already-completed worker may still be unwinding; only finish() releases its slot.
        Ok(true)
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
        if state.shutting_down || state.active_task_ids.len() >= state.max_concurrent {
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

    pub fn prepare_for_exit(&self) -> Result<(), AppError> {
        let mut state = self.lock()?;
        state.shutting_down = true;
        state.pending.clear();
        for token in state.cancellations.values() {
            token.cancel();
        }
        Ok(())
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
    fn exit_stops_workers_without_cancelling_saved_work_and_user_cancellation_stays_manual() {
        use crate::infrastructure::database::{Database, repositories::DownloadTaskRepository};
        use DownloadTaskStatus::*;
        let db = Database::open_in_memory().unwrap();
        let registry = DownloadTaskRegistry::default();
        registry.initialize_from_database(db.clone()).unwrap();
        let queued = registry
            .create(test_options("https://example.com/1", "Queued", "18"))
            .unwrap();
        let running = registry
            .create(test_options("https://example.com/2", "Running", "18"))
            .unwrap();
        let cancelled = registry
            .create(test_options("https://example.com/3", "Cancelled", "18"))
            .unwrap();
        registry.enqueue(&queued.id).unwrap();
        registry.transition(&running.id, Preparing).unwrap();
        registry.transition(&running.id, Downloading).unwrap();
        registry.cancel(&cancelled.id).unwrap();
        registry.prepare_for_exit().unwrap();
        assert!(
            registry
                .cancellation_token(&running.id)
                .unwrap()
                .is_cancelled()
        );
        assert!(registry.claim_next().unwrap().is_none());
        // Late worker callbacks must not turn shutdown into a saved cancellation/failure.
        assert!(registry.transition(&running.id, Cancelling).is_err());
        assert!(registry.transition(&running.id, Cancelled).is_err());
        assert!(registry.transition(&running.id, Failed).is_err());
        assert_eq!(
            DownloadTaskRepository::new(db.clone())
                .get(&running.id)
                .unwrap()
                .unwrap()
                .0
                .status,
            Downloading
        );
        let restarted = DownloadTaskRegistry::default();
        restarted.initialize_from_database(db).unwrap();
        assert_eq!(restarted.task(&queued.id).unwrap().status, Queued);
        assert_eq!(restarted.task(&running.id).unwrap().status, Queued);
        assert_eq!(restarted.task(&cancelled.id).unwrap().status, Cancelled);
    }

    #[test]
    fn restart_recovers_queued_and_interrupted_tasks_with_saved_options() {
        use crate::{domain::download::DownloadTaskStatus, infrastructure::database::Database};

        let database = Database::open_in_memory().unwrap();
        let first_process = DownloadTaskRegistry::default();
        first_process
            .initialize_from_database(database.clone())
            .unwrap();
        let mut queued_options = test_options("https://example.com/queued", "Queued", "18");
        queued_options.keep_intermediate_files = true;
        queued_options.use_proxy = Some(false);
        queued_options.playlist_item_count = Some(2);
        queued_options.playlist_items = Some(vec![1, 3]);
        let queued = first_process.create(queued_options).unwrap();
        let mut active_options = test_options("https://example.com/active", "Active", "22");
        active_options.keep_intermediate_files = true;
        active_options.use_proxy = Some(true);
        active_options.playlist_item_count = Some(2);
        active_options.playlist_items = Some(vec![2, 5]);
        let interrupted = first_process.create(active_options).unwrap();
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
        assert_eq!(recovered_interrupted.status, DownloadTaskStatus::Queued);
        assert_eq!(recovered_queued.format_details, queued.format_details);
        assert_eq!(
            recovered_interrupted.format_details,
            interrupted.format_details
        );
        let (claimed, options) = second_process.claim_next().unwrap().unwrap();
        assert_eq!(claimed.id, queued.id);
        assert!(options.keep_intermediate_files);
        assert_eq!(options.playlist_items, Some(vec![1, 3]));
        assert_eq!(options.use_proxy, Some(false));
        second_process.finish(&claimed.id).unwrap();
        let (next, options) = second_process.claim_next().unwrap().unwrap();
        assert_eq!(next.id, interrupted.id);
        assert!(options.keep_intermediate_files);
        assert_eq!(options.playlist_items, Some(vec![2, 5]));
        assert_eq!(options.use_proxy, Some(true));
    }

    #[test]
    fn advanced_snapshot_survives_global_changes_restart_cancel_retry_and_completion() {
        use crate::{
            domain::download_defaults::DownloadOptionDefaults,
            infrastructure::database::{Database, repositories::DownloadTaskRepository},
            services::download_defaults,
        };
        let directory = std::env::temp_dir().join(format!(
            "savebeam-option-lifecycle-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("tasks.sqlite3");
        let selected = DownloadOptionDefaults {
            audio_only: true,
            subtitle_languages: vec!["en".into(), "zh-Hans".into()],
            write_automatic_subtitles: true,
            write_thumbnail: true,
            write_info_json: true,
            embed_metadata: true,
            keep_intermediate_files: true,
        };
        let mut records = Vec::new();
        {
            let db = Database::open(&path).unwrap();
            download_defaults::save(db.clone(), selected.clone()).unwrap();
            let registry = DownloadTaskRegistry::default();
            registry.initialize_from_database(db.clone()).unwrap();
            for status in [
                DownloadTaskStatus::Queued,
                DownloadTaskStatus::Preparing,
                DownloadTaskStatus::Cancelled,
                DownloadTaskStatus::Completed,
            ] {
                let mut options = test_options(
                    "https://example.invalid/video",
                    "Snapshot",
                    "bestaudio/best",
                );
                options.output_directory = directory.to_string_lossy().into();
                download_defaults::load(db.clone())
                    .unwrap()
                    .apply_to(&mut options);
                // This task-only override must survive too, independently of global defaults.
                options.audio_only = true;
                options.write_info_json = false;
                options.quality_policy = Some(crate::domain::playlist_quality::PlaylistQuality {
                    automatic_recommendations: true,
                    max_height: Some(720),
                    max_video_bitrate_kbps: Some(2000),
                    max_audio_bitrate_kbps: Some(128),
                    allow_exceed: false,
                    resolution_height: Some(720),
                    frame_rate: Some(30),
                    video_extension: Some("webm".into()),
                    video_codec: Some("vp9".into()),
                    audio_extension: Some("webm".into()),
                    audio_codec: Some("opus".into()),
                });
                let task = registry.create(options.clone()).unwrap();
                match status {
                    DownloadTaskStatus::Preparing => {
                        registry.transition(&task.id, status).unwrap();
                    }
                    DownloadTaskStatus::Cancelled => {
                        registry.cancel(&task.id).unwrap();
                    }
                    DownloadTaskStatus::Completed => {
                        registry
                            .transition(&task.id, DownloadTaskStatus::Preparing)
                            .unwrap();
                        registry
                            .transition(&task.id, DownloadTaskStatus::Downloading)
                            .unwrap();
                        registry
                            .transition(&task.id, DownloadTaskStatus::PostProcessing)
                            .unwrap();
                        registry.transition(&task.id, status).unwrap();
                    }
                    _ => {}
                }
                records.push((task.id, status, options));
            }
            download_defaults::save(db, DownloadOptionDefaults::default()).unwrap();
        }
        let db = Database::open(&path).unwrap();
        let registry = DownloadTaskRegistry::default();
        registry.initialize_from_database(db.clone()).unwrap();
        let repository = DownloadTaskRepository::new(db.clone());
        for (id, status, expected) in &records {
            assert_eq!(repository.get(id).unwrap().unwrap().1, *expected);
            if matches!(status, DownloadTaskStatus::Cancelled) {
                assert_eq!(registry.retry(id).unwrap().1, *expected);
            }
            let args =
                crate::security::download_args::build_download_args(expected, &Default::default())
                    .unwrap();
            for flag in [
                "--extract-audio",
                "--write-subs",
                "--write-auto-subs",
                "--write-thumbnail",
                "--embed-metadata",
                "--keep-video",
            ] {
                assert!(args.iter().any(|arg| arg == flag), "{flag}");
            }
            assert!(!args.iter().any(|arg| arg == "--write-info-json"));
        }
        assert_eq!(registry.claim_next().unwrap().unwrap().1, records[0].2);
        assert_eq!(
            registry.task(&records[3].0).unwrap().status,
            DownloadTaskStatus::Completed
        );
        assert_eq!(
            download_defaults::load(db.clone()).unwrap(),
            DownloadOptionDefaults::default()
        );
        drop(repository);
        drop(registry);
        drop(db);
        let _ = std::fs::remove_dir_all(directory);
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

    #[test]
    fn removal_survives_restart_and_keeps_history_task_rows_and_media() {
        use crate::domain::download::DownloadResult;
        use crate::infrastructure::database::{
            Database,
            repositories::{DownloadTaskRepository, HistoryRepository},
        };
        let database = Database::open_in_memory().unwrap();
        let registry = DownloadTaskRegistry::default();
        registry.initialize_from_database(database.clone()).unwrap();
        let completed = registry
            .create(test_options("https://example.com/one", "One", "18"))
            .unwrap();
        registry
            .transition(&completed.id, DownloadTaskStatus::Preparing)
            .unwrap();
        registry
            .transition(&completed.id, DownloadTaskStatus::Downloading)
            .unwrap();
        registry
            .transition(&completed.id, DownloadTaskStatus::Completed)
            .unwrap();
        let file = std::env::temp_dir().join(format!(
            "savebeam-delete-task-{}-{}.mp4",
            std::process::id(),
            completed.id
        ));
        std::fs::write(&file, b"fixture media").unwrap();
        let history = HistoryRepository::new(database.clone());
        history
            .insert(
                &DownloadResult {
                    task_id: completed.id.clone(),
                    title: "One".into(),
                    output_paths: vec![file.to_string_lossy().into_owned()],
                    total_bytes: 13,
                },
                1000,
            )
            .unwrap();
        let failed = registry
            .create(test_options("https://example.com/two", "Two", "18"))
            .unwrap();
        registry
            .transition(&failed.id, DownloadTaskStatus::Preparing)
            .unwrap();
        registry
            .transition(&failed.id, DownloadTaskStatus::Failed)
            .unwrap();
        let cancelled = registry
            .create(test_options("https://example.com/three", "Three", "18"))
            .unwrap();
        registry.enqueue(&cancelled.id).unwrap();
        registry.cancel(&cancelled.id).unwrap();
        for task in [&completed, &failed, &cancelled] {
            assert!(registry.remove(&task.id).unwrap());
            assert!(!registry.remove(&task.id).unwrap());
        }
        assert!(registry.list().unwrap().is_empty());
        assert!(registry.claim_next().unwrap().is_none());
        let repository = DownloadTaskRepository::new(database.clone());
        assert!(repository.list_visible().unwrap().is_empty());
        assert_eq!(repository.list().unwrap().len(), 3);
        assert!(repository.get(&completed.id).unwrap().is_some());
        assert!(history.get(&completed.id).unwrap().is_some());
        assert_eq!(std::fs::read(&file).unwrap(), b"fixture media");
        let restarted = DownloadTaskRegistry::default();
        restarted.initialize_from_database(database).unwrap();
        assert!(restarted.list().unwrap().is_empty());
        assert!(restarted.claim_next().unwrap().is_none());
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn removal_rejects_all_nonterminal_states_without_changing_them() {
        let registry = DownloadTaskRegistry::default();
        let task = registry
            .create(test_options("https://example.com/live", "Live", "18"))
            .unwrap();
        assert!(registry.remove(&task.id).is_err());
        for status in [
            DownloadTaskStatus::Preparing,
            DownloadTaskStatus::Downloading,
            DownloadTaskStatus::PostProcessing,
            DownloadTaskStatus::Cancelling,
        ] {
            registry.transition(&task.id, status).unwrap();
            assert!(registry.remove(&task.id).is_err());
            assert_eq!(registry.task(&task.id).unwrap().status, status);
        }
        registry
            .transition(&task.id, DownloadTaskStatus::Cancelled)
            .unwrap();
        assert!(registry.remove(&task.id).unwrap());
    }

    fn test_options(url: &str, title: &str, format_id: &str) -> DownloadOptions {
        DownloadOptions {
            format_details: Some(crate::domain::task_format::TaskFormat {
                output_extension: Some("mp4".into()),
                resolution: Some("1920x1080".into()),
                fps: Some(29.97),
                video_codec: Some("hvc1".into()),
                audio_codec: Some("mp4a.40.2".into()),
                audio_bitrate_kbps: Some(128.0),
                audio_extension: Some("m4a".into()),
                ..Default::default()
            }),
            thumbnail_data_url: None,
            group: None,
            batch_id: Some(super::super::download_groups::new_batch_id()),
            playlist_part: None,
            version_parent_task_id: None,
            title: title.to_owned(),
            url: url.to_owned(),
            format_id: format_id.to_owned(),
            merge_container: None,
            output_directory: "/tmp".into(),
            subtitle_languages: Vec::new(),
            conflict_strategy: crate::domain::download::DownloadConflictStrategy::Skip,
            playlist_item_count: None,
            playlist_items: None,
            expected_media_id: None,
            use_proxy: None,
            quality_policy: None,
            audio_only: false,
            write_automatic_subtitles: false,
            write_thumbnail: false,
            write_info_json: false,
            embed_metadata: false,
            keep_intermediate_files: false,
            cookies_file_path: None,
            cookies_browser: None,
            cookie_access_confirmed: false,
        }
    }
}
