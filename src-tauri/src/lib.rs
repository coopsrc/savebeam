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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(commands::app_updates::AppUpdates::default())
        .manage(commands::components::ComponentRegistry::default())
        .manage(services::component_install_registry::ComponentInstallRegistry::default())
        .manage(services::download_registry::DownloadTaskRegistry::default())
        .manage(services::concurrency::MetadataPool::default())
        .manage(infrastructure::database::DatabaseManager::default())
        .manage(commands::subscriptions::SubscriptionOperations::default())
        .manage(services::network_connection_test::NetworkConnectionTester::default())
        .manage(services::playlist_size::PlaylistSizeOperations::default())
        .setup(|app| {
            let app_data = app.path().resolve(".", BaseDirectory::AppData)?;
            let database_manager = app.state::<infrastructure::database::DatabaseManager>();
            database_manager.initialize(app_data.join("savebeam.sqlite3"));
            if let Ok(database) = database_manager.database() {
                let concurrency = services::concurrency::load(database.clone())?;
                infrastructure::database::repositories::SettingsRepository::new(database.clone())
                    .set("queue.preferences", &concurrency, 0)?;
                app.state::<services::concurrency::MetadataPool>()
                    .configure(concurrency)?;
                app.state::<commands::components::ComponentRegistry>()
                    .initialize(database.clone())?;
                app.state::<services::download_registry::DownloadTaskRegistry>()
                    .initialize_from_database(database)?;
                app.state::<services::download_registry::DownloadTaskRegistry>()
                    .set_max_concurrent(concurrency.download_tasks)?;
                commands::downloads::resume_queued_downloads(app.handle().clone());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_information::get_app_information,
            commands::app_information::open_app_link,
            commands::app_updates::check_app_update,
            commands::app_updates::install_app_update,
            commands::app_updates::cancel_app_update,
            commands::concurrency::get_concurrency_preferences,
            commands::concurrency::save_concurrency_preferences,
            commands::components::get_component_status,
            commands::components::get_component_releases,
            commands::components::install_component_from_release,
            commands::components::cancel_component_install,
            commands::components::set_component_custom_path,
            commands::components::clear_component_custom_path,
            commands::components::remove_managed_component,
            commands::media::inspect_media,
            commands::media::inspect_playlist_entries,
            commands::media::match_playlist_quality,
            commands::downloads::start_playlist_download,
            commands::media::inspect_playlist_parts,
            commands::media::estimate_playlist_size,
            commands::subscriptions::list_subscriptions,
            commands::subscriptions::get_subscription_candidates,
            commands::subscriptions::subscribe_series,
            commands::subscriptions::check_subscription,
            commands::subscriptions::inspect_subscription_entries,
            commands::subscriptions::unsubscribe_series,
            commands::subscriptions::download_subscription_items,
            commands::diagnostics::export_diagnostics,
            commands::downloads::start_download,
            commands::downloads::get_download_tasks,
            commands::downloads::get_download_preferences,
            commands::downloads::get_download_option_defaults,
            commands::downloads::save_download_option_defaults,
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
            commands::records::get_record_group_members,
            commands::records::delete_record_group,
            commands::records::get_record_thumbnail,
            commands::records::get_history_file_presence,
            commands::records::get_record_group_file_presence,
            commands::records::redownload_missing_history,
            commands::downloads::retry_download,
            commands::versions::list_media_versions,
            commands::versions::check_history_source,
            commands::versions::redownload_media_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. })
            && let Some(tasks) =
                handle.try_state::<services::download_registry::DownloadTaskRegistry>()
        {
            let _ = tasks.prepare_for_exit();
        }
    });
}
