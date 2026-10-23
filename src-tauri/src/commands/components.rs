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
    infrastructure::database::{Database, repositories::SettingsRepository},
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
    database: Arc<Mutex<Option<Database>>>,
}

impl ComponentRegistry {
    pub fn initialize(&self, database: Database) -> CommandResult<()> {
        *self.database.lock().map_err(|_| settings_error())? = Some(database);
        Ok(())
    }

    fn settings(&self) -> CommandResult<SettingsRepository> {
        self.database
            .lock()
            .map_err(|_| settings_error())?
            .clone()
            .map(SettingsRepository::new)
            .ok_or_else(settings_error)
    }

    pub(crate) fn custom_paths(&self) -> CommandResult<HashMap<ComponentKind, PathBuf>> {
        let settings = self.settings()?;
        let mut paths = HashMap::new();
        for kind in ComponentKind::ALL {
            if let Some(path) = settings.get::<String>(path_key(kind))? {
                if !PathBuf::from(&path).is_absolute() || path.contains('\0') || path.len() > 32768
                {
                    return Err(AppError::new(
                        ErrorCode::InvalidPath,
                        "保存的组件路径无效，请重新指定或恢复自动检测。",
                        false,
                    ));
                }
                paths.insert(kind, PathBuf::from(path));
            }
        }
        Ok(paths)
    }

    fn save_path(&self, kind: ComponentKind, path: &str) -> CommandResult<()> {
        let canonical = PathBuf::from(path.trim()).canonicalize().map_err(|error| {
            AppError::new(
                ErrorCode::InvalidPath,
                "找不到该组件文件，请检查路径。",
                false,
            )
            .with_diagnostic(error.to_string())
        })?;
        if !is_usable_file(&canonical) {
            return Err(AppError::new(
                ErrorCode::InvalidPath,
                "所选路径不是可执行文件。",
                false,
            ));
        }
        let path = canonical.to_str().ok_or_else(|| {
            AppError::new(ErrorCode::InvalidPath, "组件路径必须是有效文本。", false)
        })?;
        let updated = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| settings_error())?
            .as_millis();
        self.settings()?.set(
            path_key(kind),
            &path,
            u64::try_from(updated).map_err(|_| settings_error())?,
        )
    }

    fn clear_path(&self, kind: ComponentKind) -> CommandResult<()> {
        self.settings()?.remove(path_key(kind))?;
        Ok(())
    }
}

fn settings_error() -> AppError {
    AppError::new(
        ErrorCode::Unknown,
        "组件设置暂时不可用，请检查本地数据库。",
        true,
    )
}

fn path_key(kind: ComponentKind) -> &'static str {
    match kind {
        ComponentKind::YtDlp => "component.path.yt_dlp",
        ComponentKind::Ffmpeg => "component.path.ffmpeg",
        ComponentKind::Ffprobe => "component.path.ffprobe",
        ComponentKind::JavaScriptRuntime => "component.path.javascript_runtime",
    }
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
    let custom_paths = registry.custom_paths()?;

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
    registry.save_path(kind, &path)
}

#[tauri::command]
pub fn clear_component_custom_path(
    kind: ComponentKind,
    registry: State<'_, ComponentRegistry>,
) -> CommandResult<()> {
    registry.clear_path(kind)
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
    let custom_paths = registry.custom_paths()?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::component::{ComponentSource, ComponentStatus};

    fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "savebeam-component-settings-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }
    fn executable(path: &std::path::Path) {
        std::fs::write(path, "fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    fn registry(database: Database) -> ComponentRegistry {
        let registry = ComponentRegistry::default();
        registry.initialize(database).unwrap();
        registry
    }

    #[test]
    fn paths_survive_database_and_registry_reopen_and_reset_is_persistent() {
        let root = root();
        let path = root.join("工具 with spaces");
        executable(&path);
        let expected = path.canonicalize().unwrap();
        {
            let first = registry(Database::open(root.join("state.sqlite3")).unwrap());
            for kind in ComponentKind::ALL {
                first.save_path(kind, path.to_str().unwrap()).unwrap();
            }
        }
        {
            let second = registry(Database::open(root.join("state.sqlite3")).unwrap());
            for kind in ComponentKind::ALL {
                assert_eq!(second.custom_paths().unwrap()[&kind], expected);
            }
            second.clear_path(ComponentKind::YtDlp).unwrap();
        }
        let third = registry(Database::open(root.join("state.sqlite3")).unwrap());
        assert_eq!(third.custom_paths().unwrap().len(), 3);
        assert!(
            !third
                .custom_paths()
                .unwrap()
                .contains_key(&ComponentKind::YtDlp)
        );
    }

    #[test]
    fn failed_validation_and_database_writes_never_replace_a_saved_path() {
        let root = root();
        let old = root.join("old");
        let new = root.join("new");
        executable(&old);
        executable(&new);
        let database = Database::open_in_memory().unwrap();
        let registry = registry(database.clone());
        registry
            .save_path(ComponentKind::Ffmpeg, old.to_str().unwrap())
            .unwrap();
        assert!(
            registry
                .save_path(ComponentKind::Ffmpeg, root.to_str().unwrap())
                .is_err()
        );
        assert!(
            registry
                .save_path(ComponentKind::Ffmpeg, "missing")
                .is_err()
        );
        database.with_connection(|connection| connection.execute_batch("CREATE TRIGGER reject_settings BEFORE INSERT ON app_settings BEGIN SELECT RAISE(ABORT, 'fixture'); END;")).unwrap();
        assert!(
            registry
                .save_path(ComponentKind::Ffmpeg, new.to_str().unwrap())
                .is_err()
        );
        assert_eq!(
            registry.custom_paths().unwrap()[&ComponentKind::Ffmpeg],
            old.canonicalize().unwrap()
        );
    }

    #[test]
    fn corrupt_settings_are_not_silently_ignored_and_can_be_cleared() {
        let database = Database::open_in_memory().unwrap();
        let registry = registry(database.clone());
        let settings = SettingsRepository::new(database);
        settings
            .set(path_key(ComponentKind::YtDlp), &42, 0)
            .unwrap();
        assert!(registry.custom_paths().is_err());
        registry.clear_path(ComponentKind::YtDlp).unwrap();
        assert!(registry.custom_paths().unwrap().is_empty());
        assert!(ComponentRegistry::default().custom_paths().is_err());
    }

    #[test]
    fn missing_saved_executable_remains_visible_and_does_not_silently_fall_back() {
        let root = root();
        let custom = root.join("custom");
        executable(&custom);
        let registry = registry(Database::open_in_memory().unwrap());
        registry
            .save_path(ComponentKind::YtDlp, custom.to_str().unwrap())
            .unwrap();
        std::fs::remove_file(&custom).unwrap();
        executable(&root.join("yt-dlp"));
        let detector = ComponentDetector::with_search_paths(
            ComponentPaths::from_app_data_dir(root.join("data")),
            vec![root.clone()],
            vec![],
        );
        let paths = registry.custom_paths().unwrap();
        let detected = detector.detect(ComponentKind::YtDlp, Some(&paths[&ComponentKind::YtDlp]));
        assert_eq!(detected.source, Some(ComponentSource::Custom));
        assert_eq!(detected.status, ComponentStatus::Missing);
        registry.clear_path(ComponentKind::YtDlp).unwrap();
        assert_eq!(
            detector.detect(ComponentKind::YtDlp, None).source,
            Some(ComponentSource::System)
        );
    }
}
