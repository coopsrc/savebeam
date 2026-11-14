use crate::{
    commands::{downloads::resume_queued_downloads, ipc::CommandResult},
    infrastructure::database::{DatabaseManager, repositories::SettingsRepository},
    services::{
        concurrency::{self, ConcurrencyPreferences, MetadataPool},
        download_registry::DownloadTaskRegistry,
    },
};
use tauri::{AppHandle, State};
#[tauri::command]
pub fn get_concurrency_preferences(
    database: State<'_, DatabaseManager>,
) -> CommandResult<ConcurrencyPreferences> {
    concurrency::load(database.database()?)
}
#[tauri::command]
pub fn save_concurrency_preferences(
    app: AppHandle,
    preferences: ConcurrencyPreferences,
    database: State<'_, DatabaseManager>,
    tasks: State<'_, DownloadTaskRegistry>,
    metadata: State<'_, MetadataPool>,
) -> CommandResult<ConcurrencyPreferences> {
    preferences.validate()?;
    SettingsRepository::new(database.database()?).set(
        "queue.preferences",
        &preferences,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |t| t.as_millis() as u64),
    )?;
    tasks.set_max_concurrent(preferences.download_tasks)?;
    metadata.configure(preferences)?;
    resume_queued_downloads(app);
    Ok(preferences)
}
