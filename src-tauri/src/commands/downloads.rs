//! Single-download lifecycle IPC commands.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Emitter, Manager, State};

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
        download::{DownloadOptions, DownloadTask, DownloadTaskStatus},
        error::{AppError, ErrorCode},
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
) -> CommandResult<DownloadTask> {
    if options.output_directory.trim().is_empty() {
        options.output_directory = app
            .path()
            .download_dir()
            .map_err(|error| {
                AppError::new(ErrorCode::InvalidPath, "无法获取系统下载目录。", false)
                    .with_diagnostic(error.to_string())
            })?
            .to_string_lossy()
            .into_owned();
    }
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
pub fn get_download_tasks(
    tasks: State<'_, DownloadTaskRegistry>,
) -> CommandResult<Vec<DownloadTask>> {
    tasks.list()
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

    let result = (|| {
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
        let mut args = build_download_args(&options)?;
        append_option_before_url(&mut args, "--ffmpeg-location", Path::new(ffmpeg))?;
        let executable = PathBuf::from(ytdlp);
        let cancellation = tasks.cancellation_token(&task_id)?;
        let process_output =
            ProcessSupervisor::run(&executable, &args, &task_id, &cancellation, |progress| {
                let target = progress.status;
                if target != current_status
                    && let Some(task) = transition_and_emit(&app, &tasks, &task_id, target)
                {
                    current_status = task.status;
                }
                let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, EventPayload::new(progress));
            })?;
        verify_download_outputs(
            process_output,
            &task_id,
            &options.title,
            Path::new(&options.output_directory),
        )
    })();

    match result {
        Ok(result) => {
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
