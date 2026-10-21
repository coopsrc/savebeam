//! Single-download lifecycle IPC commands.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    commands::{
        components::ComponentRegistry,
        ipc::{
            CommandResult, DOWNLOAD_ERROR_EVENT, DOWNLOAD_PROGRESS_EVENT, DOWNLOAD_RESULT_EVENT,
            DOWNLOAD_STATE_CHANGED_EVENT, EventPayload,
        },
    },
    domain::{
        component::{ComponentInstallation, ComponentKind, ComponentStatus},
        download::DownloadHistoryRecord,
        download::{
            CookiePreferences, DownloadOptions, DownloadPreferences, DownloadTask,
            DownloadTaskStatus, MAX_PLAYLIST_ITEMS,
        },
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{
        DatabaseManager,
        repositories::{HistoryRepository, SettingsRepository},
    },
    infrastructure::process_supervisor::ProcessSupervisor,
    security::download_args::build_download_args,
    services::{
        component_detector::ComponentDetector, component_paths::ComponentPaths,
        component_probe::probe_all, download_registry::DownloadTaskRegistry,
        download_verifier::verify_download_outputs,
    },
};

#[tauri::command]
pub fn start_download(
    app: AppHandle,
    mut options: DownloadOptions,
    components: State<'_, ComponentRegistry>,
    tasks: State<'_, DownloadTaskRegistry>,
    database: State<'_, DatabaseManager>,
) -> CommandResult<DownloadTask> {
    // Cookie sources are app-wide settings and must never be copied into a
    // task row supplied by an older client or crafted IPC call.
    options.cookies_file_path = None;
    options.cookies_browser = None;
    options.cookie_access_confirmed = false;
    let preferences = get_preferences(database.inner())?;
    if options.output_directory.trim().is_empty() {
        options.output_directory = if preferences.output_directory.is_empty() {
            app.path()
                .download_dir()
                .map_err(|error| {
                    AppError::new(ErrorCode::InvalidPath, "无法获取系统下载目录。", false)
                        .with_diagnostic(error.to_string())
                })?
                .to_string_lossy()
                .into_owned()
        } else {
            preferences.output_directory.clone()
        };
    }
    options.conflict_strategy = preferences.conflict_strategy;
    tasks.set_max_concurrent(preferences.max_concurrent)?;
    validate_task_options(&options)?;
    let task = tasks.create(options.clone())?;
    tasks.enqueue(&task.id)?;
    launch_next_task(
        app.clone(),
        components.inner().clone(),
        tasks.inner().clone(),
    );
    Ok(task)
}

#[tauri::command]
pub fn get_download_preferences(
    database: State<'_, DatabaseManager>,
) -> CommandResult<DownloadPreferences> {
    get_preferences(database.inner())
}

#[tauri::command]
pub fn save_download_preferences(
    preferences: DownloadPreferences,
    database: State<'_, DatabaseManager>,
    tasks: State<'_, DownloadTaskRegistry>,
) -> CommandResult<DownloadPreferences> {
    if !(1..=4).contains(&preferences.max_concurrent) {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "并发任务数必须在 1 到 4 之间。",
            false,
        ));
    }
    if !preferences.output_directory.trim().is_empty() {
        let path = Path::new(&preferences.output_directory);
        if !path.is_absolute() || !path.is_dir() {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "下载目录必须是已存在的绝对路径。",
                false,
            ));
        }
    }
    SettingsRepository::new(database.database()?).set(
        "download.preferences",
        &preferences,
        unix_ms_now()?,
    )?;
    tasks.set_max_concurrent(preferences.max_concurrent)?;
    Ok(preferences)
}

#[tauri::command]
pub fn get_cookie_preferences(
    database: State<'_, DatabaseManager>,
) -> CommandResult<CookiePreferences> {
    load_cookie_preferences(database.inner())
}

#[tauri::command]
pub fn save_cookie_preferences(
    preferences: CookiePreferences,
    database: State<'_, DatabaseManager>,
) -> CommandResult<CookiePreferences> {
    validate_cookie_preferences(&preferences)?;
    SettingsRepository::new(database.database()?).set(
        "privacy.cookies",
        &preferences,
        unix_ms_now()?,
    )?;
    Ok(preferences)
}

pub(crate) fn load_cookie_preferences(
    database: &DatabaseManager,
) -> CommandResult<CookiePreferences> {
    SettingsRepository::new(database.database()?)
        .get("privacy.cookies")
        .map(|value| value.unwrap_or_default())
}

fn validate_cookie_preferences(preferences: &CookiePreferences) -> CommandResult<()> {
    if preferences.cookies_file_path.is_some() && preferences.cookies_browser.is_some() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "全局 Cookie 只能配置一种来源。",
            false,
        ));
    }
    if (preferences.cookies_file_path.is_some() || preferences.cookies_browser.is_some())
        && !preferences.access_confirmed
    {
        return Err(AppError::new(
            ErrorCode::PermissionDenied,
            "启用全局登录 Cookie 前需要明确确认授权。",
            false,
        ));
    }
    if let Some(path) = &preferences.cookies_file_path {
        let file = Path::new(path);
        if path.contains('\0')
            || file.extension().and_then(|extension| extension.to_str()) != Some("txt")
            || !file.is_file()
        {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "请选择一个存在且可访问的 .txt Cookie 文件。",
                false,
            ));
        }
    }
    Ok(())
}

fn get_preferences(database: &DatabaseManager) -> CommandResult<DownloadPreferences> {
    Ok(SettingsRepository::new(database.database()?)
        .get("download.preferences")?
        .unwrap_or_default())
}

#[tauri::command]
pub fn get_download_tasks(
    tasks: State<'_, DownloadTaskRegistry>,
) -> CommandResult<Vec<DownloadTask>> {
    tasks.list()
}

#[tauri::command]
pub fn get_download_history(
    query: Option<String>,
    database: State<'_, DatabaseManager>,
) -> CommandResult<Vec<DownloadHistoryRecord>> {
    let repository = HistoryRepository::new(database.database()?);
    repository.search(query.as_deref().unwrap_or(""))
}

#[tauri::command]
pub async fn delete_download_history(
    task_id: String,
    delete_files: Option<bool>,
    database: State<'_, DatabaseManager>,
) -> CommandResult<bool> {
    let database = database.database()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::services::history_deletion::delete_history_entry(
            &database,
            &task_id,
            delete_files.unwrap_or(false),
        )
    })
    .await
    .map_err(|_| {
        AppError::new(
            ErrorCode::Unknown,
            "删除历史操作未完成，记录可能仍保留。",
            true,
        )
    })?
}

#[tauri::command]
pub fn open_history_file(
    app: AppHandle,
    task_id: String,
    output_index: usize,
    database: State<'_, DatabaseManager>,
) -> CommandResult<()> {
    open_history_path(&app, &task_id, output_index, false, database.inner())
}

#[tauri::command]
pub fn open_history_folder(
    app: AppHandle,
    task_id: String,
    output_index: usize,
    database: State<'_, DatabaseManager>,
) -> CommandResult<()> {
    open_history_path(&app, &task_id, output_index, true, database.inner())
}

fn open_history_path(
    app: &AppHandle,
    task_id: &str,
    output_index: usize,
    folder: bool,
    database: &DatabaseManager,
) -> CommandResult<()> {
    let history = HistoryRepository::new(database.database()?)
        .search("")?
        .into_iter()
        .find(|record| record.task_id == task_id)
        .ok_or_else(|| AppError::new(ErrorCode::InvalidPath, "找不到对应的下载历史。", false))?;
    let output = history
        .output_paths
        .get(output_index)
        .ok_or_else(|| AppError::new(ErrorCode::InvalidPath, "下载记录中不存在此文件。", false))?;
    let path = PathBuf::from(output);
    let path = if folder {
        path.parent()
            .ok_or_else(|| AppError::new(ErrorCode::InvalidPath, "无法定位文件所在目录。", false))?
            .to_path_buf()
    } else {
        path
    };
    if !path.exists() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "本地文件或目录已不存在。",
            false,
        ));
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            AppError::new(ErrorCode::Unknown, "无法打开本地文件或目录。", true)
                .with_diagnostic(error.to_string())
        })
}

pub(crate) fn resume_queued_downloads(app: AppHandle) {
    if let (Some(components), Some(tasks)) = (
        app.try_state::<ComponentRegistry>(),
        app.try_state::<DownloadTaskRegistry>(),
    ) {
        launch_next_task(
            app.clone(),
            components.inner().clone(),
            tasks.inner().clone(),
        );
    }
}

#[tauri::command]
pub fn cancel_download(
    app: AppHandle,
    task_id: String,
    tasks: State<'_, DownloadTaskRegistry>,
) -> CommandResult<DownloadTask> {
    let task = tasks.cancel(&task_id)?;
    emit_task(&app, &task);
    Ok(task)
}

#[tauri::command]
pub fn retry_download(
    app: AppHandle,
    task_id: String,
    components: State<'_, ComponentRegistry>,
    tasks: State<'_, DownloadTaskRegistry>,
) -> CommandResult<DownloadTask> {
    let (task, _options) = tasks.retry(&task_id)?;
    tasks.enqueue(&task_id)?;
    emit_task(&app, &task);
    launch_next_task(
        app.clone(),
        components.inner().clone(),
        tasks.inner().clone(),
    );
    Ok(task)
}

fn launch_next_task(app: AppHandle, components: ComponentRegistry, tasks: DownloadTaskRegistry) {
    while let Ok(Some((task, options))) = tasks.claim_next() {
        let task_id = task.id.clone();
        let completion_task_id = task_id.clone();
        let worker_app = app.clone();
        let worker_components = components.clone();
        let worker_tasks = tasks.clone();
        let scheduler_app = app.clone();
        let scheduler_components = components.clone();
        let scheduler_tasks = tasks.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run_task(
                worker_app,
                worker_tasks.clone(),
                worker_components,
                options,
                task_id,
            );
            let _ = worker_tasks.finish(&completion_task_id);
            launch_next_task(scheduler_app, scheduler_components, scheduler_tasks);
        });
    }
}

fn validate_task_options(options: &DownloadOptions) -> CommandResult<()> {
    if options.title.trim().is_empty() || options.title.chars().count() > 1024 {
        return Err(AppError::new(
            ErrorCode::InvalidUrl,
            "无法读取有效的视频标题，请重新解析链接。",
            false,
        ));
    }
    if options
        .playlist_item_count
        .is_some_and(|count| !(1..=MAX_PLAYLIST_ITEMS).contains(&count))
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "播放列表下载数量必须在 1 到 50 之间。",
            false,
        ));
    }
    if options.write_automatic_subtitles && options.subtitle_languages.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "选择自动字幕前，请先指定至少一种字幕语言。",
            false,
        ));
    }
    Ok(())
}

fn run_task(
    app: AppHandle,
    tasks: DownloadTaskRegistry,
    components: ComponentRegistry,
    options: DownloadOptions,
    task_id: String,
) {
    let Some(preparing_task) =
        transition_and_emit(&app, &tasks, &task_id, DownloadTaskStatus::Preparing)
    else {
        return;
    };
    let mut current_status = preparing_task.status;

    let result = (|| -> Result<_, AppError> {
        let app_data = app.path().app_data_dir().map_err(|error| {
            AppError::new(ErrorCode::Unknown, "无法访问应用数据目录。", false)
                .with_diagnostic(error.to_string())
        })?;
        let custom_paths = components
            .custom_paths
            .lock()
            .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
            .clone();
        let detector =
            ComponentDetector::from_environment(ComponentPaths::from_app_data_dir(app_data));
        let installations = probe_all(detector.detect_all(&custom_paths));
        let ytdlp = required_component(&installations, ComponentKind::YtDlp)?;
        let ffmpeg = required_component(&installations, ComponentKind::Ffmpeg)?;
        if options.audio_only {
            required_component(&installations, ComponentKind::Ffprobe)?;
        }
        let cookies = load_cookie_preferences(app.state::<DatabaseManager>().inner())?;
        let mut args = build_download_args(&options, &cookies)?;
        append_option_before_url(&mut args, "--ffmpeg-location", Path::new(ffmpeg))?;
        let executable = PathBuf::from(ytdlp);
        let cancellation = tasks.cancellation_token(&task_id)?;
        let mut process_output =
            ProcessSupervisor::run(&executable, &args, &task_id, &cancellation, |progress| {
                let target = progress.status;
                if target != current_status
                    && let Some(task) = transition_and_emit(&app, &tasks, &task_id, target)
                {
                    current_status = task.status;
                }
                let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, EventPayload::new(progress));
            })?;
        let intermediates = std::mem::take(&mut process_output.intermediate_files);
        let result = verify_download_outputs(
            process_output,
            &task_id,
            &options.title,
            Path::new(&options.output_directory),
        )?;
        if options.keep_intermediate_files {
            crate::services::intermediate_files::organize_retained_streams(
                &intermediates,
                &result.output_paths,
                Path::new(&options.output_directory),
            );
        }
        Ok(result)
    })();

    match result {
        Ok(result) => {
            if let Some(database) = app.try_state::<DatabaseManager>() {
                match database.database().and_then(|database| {
                    HistoryRepository::new(database).insert(&result, unix_ms_now()?)
                }) {
                    Ok(()) => {}
                    Err(error) => {
                        let _ = app.emit(DOWNLOAD_ERROR_EVENT, EventPayload::new(error));
                    }
                }
            }
            let _ = app.emit(DOWNLOAD_RESULT_EVENT, EventPayload::new(result));
            if current_status == DownloadTaskStatus::Preparing {
                let _ =
                    transition_and_emit(&app, &tasks, &task_id, DownloadTaskStatus::Downloading);
            }
            let _ = transition_and_emit(&app, &tasks, &task_id, DownloadTaskStatus::Completed);
        }
        Err(error) => {
            let target = if error.code == ErrorCode::Cancelled {
                if current_status != DownloadTaskStatus::Cancelling {
                    let _ =
                        transition_and_emit(&app, &tasks, &task_id, DownloadTaskStatus::Cancelling);
                }
                DownloadTaskStatus::Cancelled
            } else {
                DownloadTaskStatus::Failed
            };
            if let Some(task) = transition_and_emit(&app, &tasks, &task_id, target) {
                let _ = task;
                let _ = app.emit(DOWNLOAD_ERROR_EVENT, EventPayload::new(error));
            }
        }
    }
}

fn unix_ms_now() -> CommandResult<u64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))
}

fn required_component(
    installations: &[ComponentInstallation],
    kind: ComponentKind,
) -> CommandResult<&str> {
    let installation = installations
        .iter()
        .find(|installation| installation.kind == kind)
        .expect("all component kinds are discovered");
    let executable = installation.executable_path.as_deref().ok_or_else(|| {
        AppError::new(
            ErrorCode::ComponentMissing,
            format!(
                "尚未安装 {}，请前往设置页配置运行组件。",
                kind.display_name()
            ),
            false,
        )
    })?;
    if installation.status != ComponentStatus::Available {
        return Err(AppError::new(
            ErrorCode::ComponentTooOld,
            format!(
                "{} 当前不可用，请在设置页更新或重新配置。",
                kind.display_name()
            ),
            false,
        ));
    }
    Ok(executable)
}

fn append_option_before_url(
    args: &mut Vec<OsString>,
    option: &str,
    value: &Path,
) -> CommandResult<()> {
    if !value.is_file() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "FFmpeg 可执行文件路径不可用，请重新检测组件。",
            false,
        ));
    }
    if args.len() < 2 || args.get(args.len() - 2).is_none_or(|arg| arg != "--") {
        return Err(AppError::new(
            ErrorCode::Unknown,
            "下载参数生成失败。",
            false,
        ));
    }
    args.splice(
        args.len() - 2..args.len() - 2,
        [OsString::from(option), value.as_os_str().to_owned()],
    );
    Ok(())
}

fn transition_and_emit(
    app: &AppHandle,
    tasks: &DownloadTaskRegistry,
    task_id: &str,
    status: DownloadTaskStatus,
) -> Option<DownloadTask> {
    tasks
        .transition(task_id, status)
        .ok()
        .inspect(|task| emit_task(app, task))
}

fn emit_task(app: &AppHandle, task: &DownloadTask) {
    let _ = app.emit(
        DOWNLOAD_STATE_CHANGED_EVENT,
        EventPayload::new(task.clone()),
    );
}
