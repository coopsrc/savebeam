use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    domain::{
        download_defaults::DownloadOptionDefaults,
        error::{AppError, ErrorCode},
    },
    infrastructure::database::{Database, repositories::SettingsRepository},
};

const KEY: &str = "download.option_defaults";

pub fn validate(value: &DownloadOptionDefaults) -> Result<(), AppError> {
    crate::security::download_args::validate_subtitle_languages(&value.subtitle_languages)?;
    if value.write_automatic_subtitles && value.subtitle_languages.is_empty() {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "选择自动字幕前，请先指定至少一种字幕语言。",
            false,
        ));
    }
    Ok(())
}

pub fn load(database: Database) -> Result<DownloadOptionDefaults, AppError> {
    let mut value = SettingsRepository::new(database)
        .get(KEY)?
        .unwrap_or_default();
    validate(&value)?;
    // Audio-only is a per-download mode, never a global default (including legacy settings).
    value.audio_only = false;
    Ok(value)
}

pub fn save(
    database: Database,
    mut value: DownloadOptionDefaults,
) -> Result<DownloadOptionDefaults, AppError> {
    validate(&value)?;
    value.audio_only = false;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| AppError::new(ErrorCode::Unknown, "系统时间不可用。", false))?
        .as_millis() as u64;
    SettingsRepository::new(database).set(KEY, &value, now)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::download::DownloadOptions;

    #[test]
    fn defaults_are_validated_and_saved_without_mutating_existing_snapshots() {
        let db = Database::open_in_memory().unwrap();
        assert_eq!(load(db.clone()).unwrap(), DownloadOptionDefaults::default());
        let value = DownloadOptionDefaults {
            audio_only: true,
            subtitle_languages: vec!["en".into(), "zh-Hans".into()],
            write_automatic_subtitles: true,
            write_thumbnail: true,
            write_info_json: true,
            embed_metadata: true,
            keep_intermediate_files: true,
        };
        save(db.clone(), value.clone()).unwrap();
        let mut task = DownloadOptions::default();
        value.apply_to(&mut task); // Explicit per-task choice must survive global changes.
        save(db.clone(), DownloadOptionDefaults::default()).unwrap();
        assert_eq!(DownloadOptionDefaults::from(&task), value);
        let invalid = DownloadOptionDefaults {
            write_automatic_subtitles: true,
            ..Default::default()
        };
        assert!(save(db.clone(), invalid).is_err());
        for language in ["--exec=bad", "en,zh", "en\n"] {
            let invalid = DownloadOptionDefaults {
                subtitle_languages: vec![language.into()],
                ..Default::default()
            };
            assert!(save(db.clone(), invalid).is_err());
        }
        assert_eq!(load(db).unwrap(), DownloadOptionDefaults::default());
    }

    #[test]
    fn saved_global_flags_and_languages_survive_file_database_reopen() {
        let path = std::env::temp_dir().join(format!(
            "savebeam-defaults-{}-{}.sqlite3",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let value = DownloadOptionDefaults {
            subtitle_languages: vec!["en".into()],
            write_automatic_subtitles: true,
            audio_only: true,
            write_thumbnail: true,
            write_info_json: true,
            embed_metadata: true,
            keep_intermediate_files: true,
        };
        save(Database::open(&path).unwrap(), value.clone()).unwrap();
        let expected = DownloadOptionDefaults {
            audio_only: false,
            ..value
        };
        assert_eq!(load(Database::open(&path).unwrap()).unwrap(), expected);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }

    #[test]
    fn malformed_defaults_are_an_error_not_a_silent_reset() {
        let db = Database::open_in_memory().unwrap();
        SettingsRepository::new(db.clone())
            .set(KEY, &serde_json::json!({"audioOnly": "yes"}), 1)
            .unwrap();
        assert!(load(db.clone()).is_err());
        save(db.clone(), DownloadOptionDefaults::default()).unwrap();
        assert_eq!(load(db).unwrap(), DownloadOptionDefaults::default());
    }

    #[test]
    fn legacy_audio_default_is_ignored_without_rewriting_task_options() {
        let db = Database::open_in_memory().unwrap();
        let legacy = DownloadOptionDefaults {
            audio_only: true,
            write_thumbnail: true,
            ..Default::default()
        };
        SettingsRepository::new(db.clone())
            .set(KEY, &legacy, 1)
            .unwrap();
        let loaded = load(db.clone()).unwrap();
        assert!(!loaded.audio_only);
        assert!(loaded.write_thumbnail);
        assert!(!save(db, legacy.clone()).unwrap().audio_only);
        let mut task = DownloadOptions::default();
        legacy.apply_to(&mut task);
        assert!(task.audio_only);
        assert!(validate(&legacy).is_ok());
    }
}
