//! Component inventory IPC commands.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    commands::ipc::{COMPONENT_INSTALL_PROGRESS_EVENT, CommandResult, EventPayload},
    domain::{
        component::{ComponentInstallation, ComponentKind},
        component_manifest::ComponentRelease,
        error::{AppError, ErrorCode},
    },
    services::{
        component_detector::{ComponentDetector, is_usable_file},
        component_install_flow::{available_releases, install_from_catalog},
        component_install_registry::ComponentInstallRegistry,
        component_paths::ComponentPaths,
        component_probe::probe_all,
    },
};

#[derive(Clone, Default)]
pub struct ComponentRegistry {
    pub(crate) custom_paths: Arc<Mutex<HashMap<ComponentKind, PathBuf>>>,
}

#[tauri::command]
pub async fn get_component_releases() -> CommandResult<Vec<ComponentRelease>> {
    tauri::async_runtime::spawn_blocking(available_releases)
        .await
        .map_err(|error| {
            AppError::new(ErrorCode::Unknown, "读取组件发行目录时发生错误。", true)
                .with_diagnostic(error.to_string())
        })?
}

#[tauri::command]
pub async fn install_component_from_release(
    app: AppHandle,
    kind: ComponentKind,
    installs: State<'_, ComponentInstallRegistry>,
) -> CommandResult<ComponentInstallation> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(ErrorCode::Unknown, "无法访问应用数据目录。", false)
            .with_diagnostic(error.to_string())
    })?;
    let paths = ComponentPaths::from_app_data_dir(app_data_dir);
    let registry = installs.inner().clone();
    let cancellation = registry.begin(kind)?;
    let worker_cancellation = cancellation.clone();
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        install_from_catalog(kind, &paths, &worker_cancellation, |progress| {
            let _ = worker_app.emit(
                COMPONENT_INSTALL_PROGRESS_EVENT,
                EventPayload::new(progress),
            );
        })
    })
    .await
    .map_err(|error| {
        AppError::new(ErrorCode::Unknown, "组件安装任务意外终止。", true)
            .with_diagnostic(error.to_string())
    });
    let finish_result = registry.finish(kind);
    match (result, finish_result) {
        (Ok(installation), Ok(())) => installation,
        (Err(error), _) => Err(error),
        (Ok(_), Err(error)) => Err(error),
    }
}

#[tauri::command]
pub fn cancel_component_install(
    kind: ComponentKind,
    installs: State<'_, ComponentInstallRegistry>,
) -> CommandResult<()> {
    installs.cancel(kind)
}

#[tauri::command]
pub async fn get_component_status(
    app: AppHandle,
    registry: State<'_, ComponentRegistry>,
) -> CommandResult<Vec<ComponentInstallation>> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(ErrorCode::Unknown, "无法访问应用数据目录。", false)
            .with_diagnostic(error.to_string())
    })?;
    let paths = ComponentPaths::from_app_data_dir(app_data_dir);
    let custom_paths = registry
        .custom_paths
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
        .clone();

    tauri::async_runtime::spawn_blocking(move || {
        let detector = ComponentDetector::from_environment(paths);
        Ok(probe_all(detector.detect_all(&custom_paths)))
    })
    .await
    .map_err(|error| {
        AppError::new(ErrorCode::Unknown, "检测组件时发生错误。", true)
            .with_diagnostic(error.to_string())
    })?
}

#[tauri::command]
pub fn set_component_custom_path(
    kind: ComponentKind,
    path: String,
    registry: State<'_, ComponentRegistry>,
) -> CommandResult<()> {
    let path = PathBuf::from(path.trim());
    let canonical_path = path.canonicalize().map_err(|error| {
        AppError::new(
            ErrorCode::InvalidPath,
            "找不到该组件文件，请检查路径。",
            false,
        )
        .with_diagnostic(error.to_string())
    })?;

    if !is_usable_file(&canonical_path) {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "所选路径不是可执行文件。",
            false,
        ));
    }

    registry
        .custom_paths
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
        .insert(kind, canonical_path);
    Ok(())
}

#[tauri::command]
pub fn clear_component_custom_path(
    kind: ComponentKind,
    registry: State<'_, ComponentRegistry>,
) -> CommandResult<()> {
    registry
        .custom_paths
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
        .remove(&kind);
    Ok(())
}

#[tauri::command]
pub fn remove_managed_component(
    app: AppHandle,
    kind: ComponentKind,
    registry: State<'_, ComponentRegistry>,
) -> CommandResult<()> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(ErrorCode::Unknown, "无法访问应用数据目录。", false)
            .with_diagnostic(error.to_string())
    })?;
    let custom_paths = registry
        .custom_paths
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
        .clone();
    let paths = ComponentPaths::from_app_data_dir(app_data_dir);
    let detector = ComponentDetector::from_environment(paths.clone());
    let installation = detector.detect(kind, custom_paths.get(&kind).map(PathBuf::as_path));
    if installation.source != Some(crate::domain::component::ComponentSource::AppManaged) {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "只允许删除 Savebeam 应用管理的组件。",
            false,
        ));
    }
    crate::services::component_installer::remove_managed_component(kind, &paths)
}
