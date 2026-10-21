pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod security;
pub mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::components::ComponentRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::components::get_component_status,
            commands::components::set_component_custom_path,
            commands::components::clear_component_custom_path,
            commands::media::inspect_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
