//! Media inspection IPC command.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::{
    commands::{
        components::ComponentRegistry, downloads::load_cookie_preferences, ipc::CommandResult,
    },
    domain::{
        component::{ComponentKind, ComponentStatus},
        error::{AppError, ErrorCode},
        media::MediaInfo,
    },
    infrastructure::{database::DatabaseManager, ytdlp_process::YtDlpProcessEngine},
    services::{
        component_detector::ComponentDetector, component_paths::ComponentPaths,
        component_probe::probe_all, media_mapper::map_media_info,
        network_preferences::load_network_preferences,
        thumbnail_preview::load_thumbnail_with_network,
    },
};

/// Called on a blocking worker; follows the same configured component paths as media parsing.
pub(crate) fn subscription_engine(app: &AppHandle) -> CommandResult<YtDlpProcessEngine> {
    let registry = app.state::<ComponentRegistry>();
    let custom = registry
        .custom_paths
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
        .clone();
    let paths = ComponentPaths::from_app_data_dir(
        app.path()
            .app_data_dir()
            .map_err(|_| AppError::new(ErrorCode::InvalidPath, "应用目录不可用。", false))?,
    );
    let installations = probe_all(ComponentDetector::from_environment(paths).detect_all(&custom));
    let executable = installations
        .iter()
        .find(|item| item.kind == ComponentKind::YtDlp && item.status == ComponentStatus::Available)
        .and_then(|item| item.executable_path.as_ref())
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::ComponentMissing,
                "请先在设置中配置可用的 yt-dlp。",
                false,
            )
        })?;
    let runtime = installations
        .iter()
        .find(|item| {
            item.kind == ComponentKind::JavaScriptRuntime
                && item.status == ComponentStatus::Available
        })
        .and_then(|item| item.executable_path.as_ref())
        .map(PathBuf::from);
    let network = load_network_preferences(app.state::<DatabaseManager>().database()?)?;
    Ok(YtDlpProcessEngine::new(executable, runtime)
        .for_subscription()
        .with_network_preferences(network))
}

#[tauri::command]
pub async fn inspect_media(
    app: AppHandle,
    registry: State<'_, ComponentRegistry>,
    database: State<'_, DatabaseManager>,
    url: String,
) -> CommandResult<MediaInfo> {
    if url.len() > 4096 || !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::new(
            ErrorCode::InvalidUrl,
            "请输入有效的 http 或 https 视频链接。",
            false,
        ));
    }
    let app_data_dir = app.path().app_data_dir().map_err(|error| {
        AppError::new(ErrorCode::Unknown, "无法访问应用数据目录。", false)
            .with_diagnostic(error.to_string())
    })?;
    let custom_paths = registry
        .custom_paths
        .lock()
        .map_err(|_| AppError::new(ErrorCode::Unknown, "组件设置暂时不可用。", true))?
        .clone();
    let cookies = load_cookie_preferences(database.inner())?;
    let network = load_network_preferences(database.database()?)?;

    tauri::async_runtime::spawn_blocking(move || {
        let detector =
            ComponentDetector::from_environment(ComponentPaths::from_app_data_dir(app_data_dir));
        let installations = probe_all(detector.detect_all(&custom_paths));
        let installation = installations
            .iter()
            .find(|item| item.kind == ComponentKind::YtDlp)
            .expect("component kind list includes yt-dlp");
        let executable = installation.executable_path.as_deref().ok_or_else(|| {
            AppError::new(
                ErrorCode::ComponentMissing,
                "尚未安装 yt-dlp，请前往设置页配置运行组件。",
                false,
            )
        })?;
        if installation.status != ComponentStatus::Available {
            return Err(AppError::new(
                ErrorCode::ComponentTooOld,
                "yt-dlp 当前不可用，请在设置页更新或重新配置。",
                false,
            ));
        }
        let runtime_path = installations
            .iter()
            .find(|item| {
                item.kind == ComponentKind::JavaScriptRuntime
                    && item.status == ComponentStatus::Available
            })
            .and_then(|item| item.executable_path.as_ref())
            .map(PathBuf::from);
        let raw = YtDlpProcessEngine::new(executable, runtime_path)
            .with_network_preferences(network.clone())
            .inspect_with_cookies(&url, &cookies)?;
        let mut media = map_media_info(&raw, &url)?;
        media.thumbnail_data_url = media.thumbnail_url.as_deref().and_then(|thumbnail| {
            load_thumbnail_with_network(
                thumbnail,
                &media.webpage_url,
                raw.get("http_headers")
                    .and_then(|headers| headers.get("User-Agent"))
                    .and_then(serde_json::Value::as_str),
                &network,
            )
        });
        Ok(media)
    })
    .await
    .map_err(|error| {
        AppError::new(ErrorCode::Unknown, "解析媒体信息时发生错误。", true)
            .with_diagnostic(error.to_string())
    })?
}
