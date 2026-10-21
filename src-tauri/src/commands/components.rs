//! Component inventory IPC commands.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tauri::{AppHandle, Manager, State};

use crate::{
    commands::ipc::CommandResult,
    domain::{
        component::{ComponentInstallation, ComponentKind},
        error::{AppError, ErrorCode},
    },
    services::{
        component_detector::{ComponentDetector, is_usable_file},
        component_paths::ComponentPaths,
        component_probe::probe_all,
    },
};

#[derive(Clone, Default)]
pub struct ComponentRegistry {
    pub(crate) custom_paths: Arc<Mutex<HashMap<ComponentKind, PathBuf>>>,
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
