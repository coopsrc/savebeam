//! Atomic app-managed component replacement with automatic rollback.

use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::{
    domain::{
        component::{ComponentInstallation, ComponentKind, ComponentSource, ComponentStatus},
        error::{AppError, ErrorCode},
    },
    services::{component_paths::ComponentPaths, component_probe::probe_installation},
};

pub fn install_component(
    staged_executable: &Path,
    kind: ComponentKind,
    paths: &ComponentPaths,
) -> Result<ComponentInstallation, AppError> {
    let directory = paths
        .ensure_component_dir(kind)
        .map_err(|error| install_error("无法准备应用管理组件目录。", error))?;
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| install_error("无法定位应用管理组件目录。", error))?;
    let staged_parent = staged_executable
        .parent()
        .and_then(|path| path.canonicalize().ok())
        .ok_or_else(|| invalid_target("组件暂存目录无效。"))?;
    if !staged_parent.starts_with(&canonical_directory) {
        return Err(invalid_target(
            "待安装组件必须位于该组件的应用管理暂存目录。",
        ));
    }
    let current = paths
        .managed_executable_paths(kind)
        .into_iter()
        .find(|path| path.file_name() == staged_executable.file_name())
        .ok_or_else(|| invalid_target("组件清单中的可执行文件名称与当前平台不匹配。"))?;
    install_with_rollback(staged_executable, &current, |path| {
        let installation = ComponentInstallation {
            kind,
            source: Some(ComponentSource::AppManaged),
            status: ComponentStatus::Unhealthy,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
        };
        let checked = probe_installation(&installation);
        if checked.status == ComponentStatus::Available && checked.version.is_some() {
            Ok(())
        } else {
            Err(AppError::new(
                ErrorCode::ComponentTooOld,
                "组件未通过版本与能力检查。",
                true,
            ))
        }
    })?;
    let installation = ComponentInstallation {
        kind,
        source: Some(ComponentSource::AppManaged),
        status: ComponentStatus::Unhealthy,
        executable_path: Some(current.to_string_lossy().into_owned()),
        version: None,
    };
    Ok(probe_installation(&installation))
}

pub fn remove_managed_component(
    kind: ComponentKind,
    paths: &ComponentPaths,
) -> Result<(), AppError> {
    for executable in paths.managed_executable_paths(kind) {
        if executable.exists() {
            fs::remove_file(&executable)
                .map_err(|error| install_error("无法删除应用管理组件。", error))?;
        }
        let Some(parent) = executable.parent() else {
            continue;
        };
        let Some(name) = executable
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            continue;
        };
        for entry in fs::read_dir(parent)
            .map_err(|error| install_error("无法读取应用管理组件目录。", error))?
        {
            let entry = entry.map_err(|error| install_error("无法读取组件备份列表。", error))?;
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{name}.previous"))
            {
                fs::remove_file(entry.path())
                    .map_err(|error| install_error("无法删除组件旧版本备份。", error))?;
            }
        }
    }
    Ok(())
}

pub fn install_with_rollback(
    staged_executable: &Path,
    current_executable: &Path,
    health_check: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<Option<PathBuf>, AppError> {
    let parent = current_executable
        .parent()
        .ok_or_else(|| invalid_target("组件安装路径无效。"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| install_error("无法定位应用管理组件目录。", error))?;
    let staged_parent = staged_executable
        .parent()
        .and_then(|path| path.canonicalize().ok())
        .ok_or_else(|| invalid_target("组件暂存目录无效。"))?;
    if !parent.is_dir()
        || !staged_executable.is_file()
        || !staged_parent.starts_with(&canonical_parent)
    {
        return Err(invalid_target("组件必须从同一应用管理目录暂存后原子安装。"));
    }
    let file_name = current_executable
        .file_name()
        .ok_or_else(|| invalid_target("组件安装路径无效。"))?;
    if file_name.to_string_lossy().contains(['/', '\\', '\0']) {
        return Err(invalid_target("组件安装文件名无效。"));
    }
    let backup = next_backup_path(parent, &file_name.to_string_lossy());
    let had_current = current_executable.exists();
    if had_current {
        fs::rename(current_executable, &backup)
            .map_err(|error| install_error("无法暂存当前组件版本。", error))?;
    }
    if let Err(error) = fs::rename(staged_executable, current_executable) {
        restore_backup(had_current, &backup, current_executable);
        return Err(install_error("无法切换到新组件版本。", error));
    }
    if let Err(error) = health_check(current_executable) {
        let _ = fs::remove_file(current_executable);
        if had_current && let Err(restore_error) = fs::rename(&backup, current_executable) {
            return Err(AppError::new(
                ErrorCode::Unknown,
                "新组件检测失败，且旧版本回滚失败；请重新检测或恢复组件。",
                true,
            )
            .with_diagnostic(format!("health check: {error}; rollback: {restore_error}")));
        }
        return Err(AppError::new(
            ErrorCode::ComponentTooOld,
            "新组件未通过健康检查，已回滚到上一版本。",
            true,
        )
        .with_diagnostic(error.to_string()));
    }
    Ok(had_current.then_some(backup))
}

fn next_backup_path(parent: &Path, file_name: &str) -> PathBuf {
    let first = parent.join(format!("{file_name}.previous"));
    if !first.exists() {
        return first;
    }
    for index in 1u32.. {
        let candidate = parent.join(format!("{file_name}.previous.{index}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("finite filesystem cannot contain every u32 backup name")
}

fn restore_backup(had_current: bool, backup: &Path, target: &Path) {
    if had_current {
        let _ = fs::rename(backup, target);
    }
}

fn invalid_target(message: &str) -> AppError {
    AppError::new(ErrorCode::InvalidPath, message, false)
}
fn install_error(message: &str, error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::InvalidPath, message, true).with_diagnostic(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::install_with_rollback;

    fn temp_dir() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "savebeam-install-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn replaces_atomically_and_keeps_one_previous_version() {
        let directory = temp_dir();
        let current = directory.join("yt-dlp");
        let staged = directory.join("yt-dlp.stage");
        fs::write(&current, b"old").unwrap();
        fs::write(&staged, b"new").unwrap();
        let backup = install_with_rollback(&staged, &current, |path| {
            assert_eq!(fs::read(path).unwrap(), b"new");
            Ok(())
        })
        .unwrap()
        .unwrap();
        assert_eq!(fs::read(&current).unwrap(), b"new");
        assert_eq!(fs::read(backup).unwrap(), b"old");
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn failed_health_check_restores_previous_component() {
        let directory = temp_dir();
        let current = directory.join("ffmpeg");
        let staged = directory.join("ffmpeg.stage");
        fs::write(&current, b"old").unwrap();
        fs::write(&staged, b"broken").unwrap();
        assert!(
            install_with_rollback(&staged, &current, |_| Err(
                crate::domain::error::AppError::new(
                    crate::domain::error::ErrorCode::ComponentTooOld,
                    "bad version",
                    false,
                )
            ))
            .is_err()
        );
        assert_eq!(fs::read(&current).unwrap(), b"old");
        let _ = fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[test]
    fn managed_install_runs_the_component_probe_before_accepting_it() {
        use std::os::unix::fs::PermissionsExt;

        use crate::{
            domain::component::ComponentKind,
            services::{component_installer::install_component, component_paths::ComponentPaths},
        };

        let root = temp_dir();
        let paths = ComponentPaths::from_app_data_dir(&root);
        let directory = paths.ensure_component_dir(ComponentKind::YtDlp).unwrap();
        let stage = directory.join("staging");
        fs::create_dir_all(&stage).unwrap();
        let executable = stage.join("yt-dlp");
        fs::write(&executable, "#!/bin/sh\necho 2026.10.1\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let installed = install_component(&executable, ComponentKind::YtDlp, &paths).unwrap();
        assert_eq!(
            installed.status,
            crate::domain::component::ComponentStatus::Available
        );
        assert_eq!(installed.version.as_deref(), Some("2026.10.1"));
        assert!(paths.managed_executable_paths(ComponentKind::YtDlp)[0].is_file());
        let _ = fs::remove_dir_all(root);
    }
}
