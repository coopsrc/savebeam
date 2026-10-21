//! End-to-end verified component installation from the trusted release catalog.

use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    domain::{
        component::{ComponentInstallation, ComponentKind},
        component_manifest::current_target,
        error::{AppError, ErrorCode},
    },
    infrastructure::ytdlp_process::CancellationToken,
    services::{
        component_archive::{extract_executable, verify_sha256},
        component_catalog::fetch_verified_manifest,
        component_download::{ComponentDownloadProgress, download_to_temp},
        component_installer::install_component,
        component_paths::ComponentPaths,
    },
};

pub fn available_releases()
-> Result<Vec<crate::domain::component_manifest::ComponentRelease>, AppError> {
    let manifest = fetch_verified_manifest()?;
    let (target_os, architecture) = current_target()?;
    Ok(manifest
        .entries
        .into_iter()
        .filter(|release| release.target_os == target_os && release.architecture == architecture)
        .collect())
}

pub fn install_from_catalog(
    kind: ComponentKind,
    paths: &ComponentPaths,
    cancellation: &CancellationToken,
    on_progress: impl FnMut(ComponentDownloadProgress),
) -> Result<ComponentInstallation, AppError> {
    let manifest = fetch_verified_manifest()?;
    let (target_os, architecture) = current_target()?;
    let release = manifest
        .select_release(kind, target_os, architecture)
        .cloned()
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::ComponentMissing,
                "当前系统暂时没有该组件的受信任发行版本。",
                false,
            )
        })?;
    if cancellation.is_cancelled() {
        return Err(AppError::new(
            ErrorCode::Cancelled,
            "组件安装已取消。",
            true,
        ));
    }

    let component_directory = paths.ensure_component_dir(kind).map_err(|error| {
        AppError::new(ErrorCode::InvalidPath, "无法准备组件暂存目录。", true)
            .with_diagnostic(error.to_string())
    })?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            AppError::new(ErrorCode::Unknown, "系统时间不可用。", false)
                .with_diagnostic(error.to_string())
        })?
        .as_nanos();
    let staging_directory =
        component_directory.join(format!(".staging-{}-{timestamp}", std::process::id()));
    fs::create_dir(&staging_directory).map_err(|error| {
        AppError::new(ErrorCode::InvalidPath, "无法创建组件暂存目录。", true)
            .with_diagnostic(error.to_string())
    })?;
    let _staging_cleanup = StagingCleanup(staging_directory.clone());
    let archive = staging_directory.join("download.part");
    download_to_temp(&release, &archive, cancellation, on_progress)?;
    if cancellation.is_cancelled() {
        return Err(AppError::new(
            ErrorCode::Cancelled,
            "组件安装已取消。",
            true,
        ));
    }
    verify_sha256(&archive, &release.sha256)?;
    let executable = extract_executable(
        &archive,
        release.archive,
        &release.executable_name,
        &staging_directory,
    )?;
    if cancellation.is_cancelled() {
        return Err(AppError::new(
            ErrorCode::Cancelled,
            "组件安装已取消。",
            true,
        ));
    }
    install_component(&executable, kind, paths)
}

struct StagingCleanup(PathBuf);

impl Drop for StagingCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
