use crate::{
    commands::ipc::CommandResult, domain::network::NetworkPreferences,
    infrastructure::database::DatabaseManager, services::network_preferences,
};
use tauri::State;

#[tauri::command]
pub fn get_network_preferences(
    database: State<'_, DatabaseManager>,
) -> CommandResult<NetworkPreferences> {
    network_preferences::load_network_preferences(database.database()?)
}

#[tauri::command]
pub fn save_network_preferences(
    database: State<'_, DatabaseManager>,
    preferences: NetworkPreferences,
) -> CommandResult<NetworkPreferences> {
    network_preferences::save_network_preferences(database.database()?, &preferences)
}
