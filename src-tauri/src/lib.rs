use tauri::{Manager, path::BaseDirectory};

pub mod commands;
pub mod domain;
pub mod infrastructure;
pub mod security;
pub mod services;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::components::ComponentRegistry::default())
        .manage(services::component_install_registry::ComponentInstallRegistry::default())
        .manage(services::download_registry::DownloadTaskRegistry::default())
        .manage(infrastructure::database::DatabaseManager::default())
        .manage(commands::subscriptions::SubscriptionOperations::default())
        .manage(services::network_connection_test::NetworkConnectionTester::default())
        .setup(|app| {
            let app_data = app.path().resolve(".", BaseDirectory::AppData)?;
            let database_manager = app.state::<infrastructure::database::DatabaseManager>();
            database_manager.initialize(app_data.join("savebeam.sqlite3"));
            if let Ok(database) = database_manager.database() {
                if let Ok(Some(preferences)) =
                    infrastructure::database::repositories::SettingsRepository::new(
                        database.clone(),
                    )
                    .get::<domain::download::DownloadPreferences>("download.preferences")
                {
                    app.state::<services::download_registry::DownloadTaskRegistry>()
                        .set_max_concurrent(preferences.max_concurrent)?;
                }
                app.state::<services::download_registry::DownloadTaskRegistry>()
                    .initialize_from_database(database)?;
                commands::downloads::resume_queued_downloads(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::components::get_component_status,
            commands::components::get_component_releases,
            commands::components::install_component_from_release,
            commands::components::cancel_component_install,
            commands::components::set_component_custom_path,
            commands::components::clear_component_custom_path,
            commands::components::remove_managed_component,
            commands::media::inspect_media,
            commands::subscriptions::list_subscriptions,
            commands::subscriptions::get_subscription_candidates,
            commands::subscriptions::subscribe_series,
            commands::subscriptions::check_subscription,
            commands::subscriptions::unsubscribe_series,
            commands::subscriptions::download_subscription_items,
            commands::diagnostics::export_diagnostics,
            commands::downloads::start_download,
            commands::downloads::get_download_tasks,
            commands::downloads::get_download_preferences,
            commands::downloads::save_download_preferences,
            commands::downloads::get_cookie_preferences,
            commands::downloads::save_cookie_preferences,
            commands::network::get_network_preferences,
            commands::network::save_network_preferences,
            commands::network::test_network_connection,
            commands::downloads::get_download_history,
            commands::downloads::get_download_history_record,
            commands::downloads::delete_download_history,
            commands::downloads::open_history_file,
            commands::downloads::open_history_folder,
            commands::downloads::cancel_download,
            commands::downloads::delete_download_task,
            commands::downloads::retry_download,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. })
            && let Some(tasks) =
                handle.try_state::<services::download_registry::DownloadTaskRegistry>()
        {
            let _ = tasks.cancel_all();
        }
    });
}
