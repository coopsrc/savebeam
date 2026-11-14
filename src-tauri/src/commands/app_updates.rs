//! Fixed update endpoint/key in configuration. No frontend updater permissions or arbitrary URL IPC.
use crate::{
    commands::ipc::{CommandResult, EventPayload},
    domain::error::{AppError, ErrorCode},
    services::download_registry::DownloadTaskRegistry,
};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
const MAX_PACKAGE: usize = 256 * 1024 * 1024;
#[derive(Default)]
pub struct AppUpdates {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    cancelled: AtomicBool,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl AppUpdates {
    fn enter(&self) -> CommandResult<Busy<'_>> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| failure("另一个应用更新操作正在进行。"))?;
        Ok(Busy(&self.busy))
    }
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    phase: &'static str,
}
#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: State<'_, AppUpdates>,
) -> CommandResult<Option<UpdateInfo>> {
    let _busy = state.enter()?;
    *state
        .pending
        .lock()
        .map_err(|_| failure("应用更新状态不可用。"))? = None;
    let update = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| failure("无法初始化应用更新。"))?
        .check()
        .await
        .map_err(|_| failure("暂时无法读取应用更新，请检查网络或稍后重试。"))?;
    if update.as_ref().is_some_and(|u| {
        u.download_url.scheme() != "https" || u.body.as_ref().is_some_and(|s| s.len() > 65536)
    }) {
        return Err(failure("应用更新信息无效。"));
    }
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
    });
    *state
        .pending
        .lock()
        .map_err(|_| failure("应用更新状态不可用。"))? = update;
    Ok(info)
}
#[tauri::command]
pub fn cancel_app_update(state: State<'_, AppUpdates>) {
    state.cancelled.store(true, Ordering::Release);
}
#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    version: String,
    state: State<'_, AppUpdates>,
) -> CommandResult<()> {
    let _busy = state.enter()?;
    let update = state
        .pending
        .lock()
        .map_err(|_| failure("应用更新状态不可用。"))?
        .clone()
        .filter(|u| u.version == version)
        .ok_or_else(|| failure("请重新检查应用更新。"))?;
    if cfg!(debug_assertions) {
        return Err(failure("开发版本不能安装更新，请使用正式安装的应用。"));
    }
    state.cancelled.store(false, Ordering::Release);
    let download = async {
        let client = reqwest::Client::builder()
            .https_only(true)
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|_| failure("无法创建更新连接。"))?;
        let mut response = client
            .get(update.download_url.as_str())
            .send()
            .await
            .map_err(|_| failure("应用更新下载失败。"))?
            .error_for_status()
            .map_err(|_| failure("应用更新下载失败。"))?;
        let total = response.content_length();
        if total.is_some_and(|n| n > MAX_PACKAGE as u64) {
            return Err(failure("应用更新包超出大小限制。"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| failure("应用更新下载中断，可重新检查后重试。"))?
        {
            if state.cancelled.load(Ordering::Acquire) {
                return Err(cancelled());
            }
            if bytes.len().saturating_add(chunk.len()) > MAX_PACKAGE {
                return Err(failure("应用更新包超出大小限制。"));
            }
            bytes.extend_from_slice(&chunk);
            let _ = app.emit(
                "app://update-progress",
                EventPayload::new(Progress {
                    downloaded_bytes: bytes.len() as u64,
                    total_bytes: total,
                    phase: "downloading",
                }),
            );
        }
        update
            .verify(&bytes)
            .map_err(|_| failure("应用更新验签失败，未安装更新。"))?;
        Ok(bytes)
    };
    // An idle network stream remains cancellable without waiting for its timeout.
    let mut download = std::pin::pin!(download);
    let bytes = loop {
        match tokio::time::timeout(std::time::Duration::from_millis(200), &mut download).await {
            Ok(result) => break result?,
            Err(_) if state.cancelled.load(Ordering::Acquire) => return Err(cancelled()),
            Err(_) => {}
        }
    };
    let registry = app.state::<DownloadTaskRegistry>().inner().clone();
    if state.cancelled.load(Ordering::Acquire) {
        return Err(cancelled());
    }
    registry.begin_update()?;
    let _ = app.emit(
        "app://update-progress",
        EventPayload::new(Progress {
            downloaded_bytes: bytes.len() as u64,
            total_bytes: Some(bytes.len() as u64),
            phase: "installing",
        }),
    );
    let install_update = update.clone();
    let installed =
        tauri::async_runtime::spawn_blocking(move || install_update.install(bytes)).await;
    match installed {
        Ok(Ok(())) => {
            app.restart();
        }
        _ => {
            registry.end_update()?;
            Err(failure("应用更新安装未完成，请重新检查后重试。"))
        }
    }
}
fn failure(message: &str) -> AppError {
    AppError::new(ErrorCode::NetworkFailure, message, true)
}
fn cancelled() -> AppError {
    AppError::new(ErrorCode::Cancelled, "已取消应用更新下载。", true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_one_operation_runs_and_releases_after_failure() {
        let state = AppUpdates::default();
        let first = state.enter().unwrap();
        assert!(state.enter().is_err());
        drop(first);
        assert!(state.enter().is_ok());
    }

    #[test]
    fn fixed_configuration_requires_version_bound_signatures() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], true);
        assert_eq!(
            config["plugins"]["updater"]["endpoints"],
            serde_json::json!([
                "https://github.com/coopsrc/savebeam/releases/latest/download/latest.json"
            ])
        );
        assert!(
            !config["plugins"]["updater"]["pubkey"]
                .as_str()
                .unwrap()
                .is_empty()
        );
        assert!(!include_str!("../../capabilities/default.json").contains("updater:"));
    }
}
