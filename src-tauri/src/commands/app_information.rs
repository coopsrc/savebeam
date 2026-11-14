use crate::{
    commands::ipc::CommandResult,
    domain::error::{AppError, ErrorCode},
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInformation {
    version: String,
    platform: &'static str,
    architecture: &'static str,
}
#[tauri::command]
pub fn get_app_information(app: AppHandle) -> AppInformation {
    AppInformation {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
    }
}
#[tauri::command]
pub fn open_app_link(app: AppHandle, kind: String) -> CommandResult<()> {
    let url = match kind.as_str() {
        "feedback" => "https://github.com/coopsrc/savebeam/issues/new/choose",
        "source" => "https://github.com/coopsrc/savebeam",
        _ => {
            return Err(AppError::new(
                ErrorCode::InvalidUrl,
                "不支持的应用链接。",
                false,
            ));
        }
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "无法打开浏览器。", true))
}
