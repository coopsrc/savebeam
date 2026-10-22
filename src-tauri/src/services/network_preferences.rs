use crate::{
    domain::{
        error::{AppError, ErrorCode},
        network::NetworkPreferences,
    },
    infrastructure::database::{Database, repositories::SettingsRepository},
    security::network_proxy::normalize,
};
use std::time::{SystemTime, UNIX_EPOCH};

const SETTINGS_KEY: &str = "network.preferences";

pub fn load_task_network_preferences(
    database: Database,
    use_proxy: Option<bool>,
) -> Result<NetworkPreferences, AppError> {
    let saved = if use_proxy == Some(false) {
        NetworkPreferences::default()
    } else {
        load_network_preferences(database)?
    };
    crate::security::network_proxy::for_task(&saved, use_proxy)
}

pub fn load_network_preferences(database: Database) -> Result<NetworkPreferences, AppError> {
    normalize(
        &SettingsRepository::new(database)
            .get(SETTINGS_KEY)?
            .unwrap_or_default(),
    )
}

pub fn save_network_preferences(
    database: Database,
    preferences: &NetworkPreferences,
) -> Result<NetworkPreferences, AppError> {
    let value = normalize(preferences)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))?
        .as_millis() as u64;
    SettingsRepository::new(database).set(SETTINGS_KEY, &value, now)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::network::ProxyMode;

    #[test]
    fn direct_tasks_do_not_require_valid_global_proxy_settings_and_proxy_tasks_never_fall_back() {
        let db = Database::open_in_memory().unwrap();
        assert!(load_task_network_preferences(db.clone(), Some(true)).is_err());
        SettingsRepository::new(db.clone())
            .set(SETTINGS_KEY, &"malformed", 1)
            .unwrap();
        assert_eq!(
            load_task_network_preferences(db.clone(), Some(false))
                .unwrap()
                .proxy_mode,
            ProxyMode::Direct
        );
        assert!(load_task_network_preferences(db.clone(), Some(true)).is_err());
        assert!(load_task_network_preferences(db, None).is_err());
    }

    #[test]
    fn stored_proxy_survives_database_reopen() {
        let directory = std::env::temp_dir().join(format!(
            "savebeam-network-settings-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("settings.sqlite3");
        let value = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: "socks5h://127.0.0.1:1080".into(),
        };
        let saved = save_network_preferences(Database::open(&path).unwrap(), &value).unwrap();
        assert_eq!(
            load_network_preferences(Database::open(&path).unwrap()).unwrap(),
            saved
        );
        let _ = std::fs::remove_dir_all(directory);
    }
    #[test]
    fn defaults_round_trip_and_invalid_saves_preserve_previous_preferences() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(
            load_network_preferences(db.clone()).unwrap(),
            NetworkPreferences::default()
        );
        let preferences = NetworkPreferences {
            proxy_mode: ProxyMode::Custom,
            proxy_url: "http://127.0.0.1:7890".into(),
        };
        let saved = save_network_preferences(db.clone(), &preferences).unwrap();
        assert_eq!(load_network_preferences(db.clone()).unwrap(), saved);
        let invalid = NetworkPreferences {
            proxy_url: "http://user:secret@localhost".into(),
            ..preferences
        };
        assert!(save_network_preferences(db.clone(), &invalid).is_err());
        assert_eq!(load_network_preferences(db.clone()).unwrap(), saved);
        let direct = NetworkPreferences {
            proxy_mode: ProxyMode::Direct,
            ..saved
        };
        assert_eq!(
            save_network_preferences(db.clone(), &direct)
                .unwrap()
                .proxy_url,
            ""
        );
        assert_eq!(
            load_network_preferences(db).unwrap().proxy_mode,
            ProxyMode::Direct
        );
    }
    #[test]
    fn malformed_persisted_proxy_is_not_silently_replaced_with_direct_connection() {
        let db = Database::open_in_memory().unwrap();
        SettingsRepository::new(db.clone())
            .set(
                SETTINGS_KEY,
                &NetworkPreferences {
                    proxy_mode: ProxyMode::Custom,
                    proxy_url: "invalid".into(),
                },
                1,
            )
            .unwrap();
        assert!(load_network_preferences(db).is_err());
    }
}
