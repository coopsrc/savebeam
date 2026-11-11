//! Local deduplicated raster previews. Never load a remote URL from the record UI.
use super::Database;
use crate::domain::{download::DownloadOptions, error::AppError};
use base64::{Engine, engine::general_purpose::STANDARD};
use sha2::{Digest, Sha256};

const CACHE_LIMIT: i64 = 64 * 1024 * 1024;
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis().min(i64::MAX as u128) as i64)
}

fn trim(connection: &rusqlite::Connection, limit: i64) -> rusqlite::Result<()> {
    let mut total: i64 = connection.query_row(
        "SELECT COALESCE(SUM(length(data_url)),0) FROM record_artwork",
        [],
        |r| r.get(0),
    )?;
    while total > limit {
        let (id,size):(String,i64)=connection.query_row("SELECT artwork_id,length(data_url) FROM record_artwork ORDER BY last_used,artwork_id LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
        connection.execute("DELETE FROM task_artwork WHERE artwork_id=?1", [&id])?;
        connection.execute("DELETE FROM record_artwork WHERE artwork_id=?1", [&id])?;
        total -= size;
    }
    Ok(())
}

pub fn valid(value: &str) -> bool {
    if value.len() > 5_600_000 {
        return false;
    }
    let Some((prefix, data)) = value.split_once(",") else {
        return false;
    };
    let Ok(bytes) = STANDARD.decode(data) else {
        return false;
    };
    if bytes.len() > 4 * 1024 * 1024 {
        return false;
    }
    match prefix {
        "data:image/png;base64" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "data:image/jpeg;base64" => bytes.starts_with(b"\xff\xd8\xff"),
        "data:image/gif;base64" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "data:image/webp;base64" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        "data:image/avif;base64" => matches!(bytes.get(4..12), Some(b"ftypavif" | b"ftypavis")),
        _ => false,
    }
}

pub fn save(
    connection: &rusqlite::Connection,
    task_id: &str,
    options: &DownloadOptions,
) -> rusqlite::Result<()> {
    if let Some(value) = options.thumbnail_data_url.as_deref().filter(|s| valid(s)) {
        let id = hex::encode(Sha256::digest(value.as_bytes()));
        connection.execute(
            "INSERT INTO record_artwork VALUES(?1,?2,?3) ON CONFLICT(artwork_id) DO UPDATE SET last_used=excluded.last_used",
            rusqlite::params![id, value, now()],
        )?;
        connection.execute(
            "INSERT OR REPLACE INTO task_artwork VALUES(?1,?2)",
            rusqlite::params![task_id, id],
        )?;
    } else if let Some(parent) = &options.version_parent_task_id {
        connection.execute("INSERT OR IGNORE INTO task_artwork SELECT ?1,artwork_id FROM task_artwork WHERE task_id=?2",rusqlite::params![task_id,parent])?;
    } else if let Some(group) = &options.group {
        connection.execute("INSERT OR IGNORE INTO task_artwork SELECT ?1,a.artwork_id FROM task_artwork a JOIN download_tasks t USING(task_id) WHERE json_extract(t.group_json,'$.key')=?2 ORDER BY t.created_at_unix_ms DESC LIMIT 1",rusqlite::params![task_id,group.key])?;
    }
    trim(connection, CACHE_LIMIT)
}

pub fn get(database: &Database, task_id: &str) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension;
    database.with_connection(|c| {
        let row=c.query_row("SELECT artwork_id,data_url FROM record_artwork JOIN task_artwork a USING(artwork_id) JOIN download_tasks t ON t.task_id=a.task_id WHERE a.task_id=?1 OR json_extract(t.group_json,'$.key')=(SELECT json_extract(group_json,'$.key') FROM download_tasks WHERE task_id=?1) ORDER BY a.task_id=?1 DESC,t.created_at_unix_ms DESC LIMIT 1",[task_id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).optional()?;
        if let Some((id,_))=&row { c.execute("UPDATE record_artwork SET last_used=?2 WHERE artwork_id=?1",rusqlite::params![id,now()])?; }
        Ok(row.map(|(_,value)|value).filter(|s|valid(s)))
    })
}

pub fn attach(database: &Database, task_id: &str, value: &str) -> Result<(), AppError> {
    database.with_connection(|c| {
        let transaction = c.unchecked_transaction()?;
        save(
            &transaction,
            task_id,
            &DownloadOptions {
                thumbnail_data_url: Some(value.into()),
                ..Default::default()
            },
        )?;
        transaction.commit()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_raster_data_is_accepted() {
        assert!(valid("data:image/png;base64,iVBORw0KGgo="));
        assert!(!valid("data:image/svg+xml;base64,PHN2Zy8+"));
        assert!(!valid("data:image/png;base64,PHN2Zy8+"));
        assert!(!valid("https://example.com/image.png"));
        assert!(!valid(&"x".repeat(5_600_001)));
    }

    #[test]
    fn eviction_removes_only_old_image_cache_not_task_records() {
        let db = Database::open_in_memory().unwrap();
        db.with_connection(|c|{
            c.execute_batch("INSERT INTO download_tasks(task_id,url,title,format_id,output_directory,status,created_at_unix_ms,updated_at_unix_ms) VALUES('old','https://example.com','Title','v','/fixture','completed',1,1);
              INSERT INTO record_artwork VALUES('old-image','12345678',1),('new-image','12345678',2);
              INSERT INTO task_artwork VALUES('old','old-image');")?;
            trim(c,8)?;
            assert_eq!(c.query_row("SELECT artwork_id FROM record_artwork",[],|r|r.get::<_,String>(0))?,"new-image");
            assert_eq!(c.query_row("SELECT COUNT(*) FROM download_tasks",[],|r|r.get::<_,u32>(0))?,1);
            assert_eq!(c.query_row("SELECT COUNT(*) FROM task_artwork",[],|r|r.get::<_,u32>(0))?,0);
            Ok(())
        }).unwrap();
    }

    #[test]
    fn artwork_is_deduplicated_inherited_and_read_after_database_reopen() {
        use crate::domain::download::{
            DownloadGroupHint, DownloadGroupKind, DownloadTask, DownloadTaskStatus,
        };
        use crate::infrastructure::database::repositories::{
            DownloadTaskRepository, HistoryRepository,
        };
        let path = std::env::temp_dir().join(format!(
            "savebeam-artwork-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let image = "data:image/png;base64,iVBORw0KGgo=";
        {
            let db = Database::open(&path).unwrap();
            let repo = DownloadTaskRepository::new(db.clone());
            let group = crate::services::download_groups::make(
                "https://example.com/series",
                Some(&DownloadGroupHint {
                    title: "Series".into(),
                    kind: DownloadGroupKind::Collection,
                }),
                Some(1),
                None,
            )
            .unwrap();
            for (id, thumbnail, parent, context) in [
                ("first", Some(image.into()), None, Some(group.clone())),
                ("sibling", None, None, Some(group)),
                ("version", None, Some("first".into()), None),
            ] {
                let options = DownloadOptions {
                    url: "https://example.com/series".into(),
                    group: context,
                    thumbnail_data_url: thumbnail,
                    version_parent_task_id: parent,
                    ..Default::default()
                };
                repo.insert(
                    &DownloadTask {
                        batch_id: None,
                        id: id.into(),
                        url: options.url.clone(),
                        title: id.into(),
                        format_id: "v".into(),
                        status: DownloadTaskStatus::Completed,
                        created_at_unix_ms: 1,
                        group: options.group.clone(),
                    },
                    &options,
                )
                .unwrap();
            }
            assert_eq!(
                db.with_connection(|c| c.query_row(
                    "SELECT COUNT(*) FROM record_artwork",
                    [],
                    |r| r.get::<_, u32>(0)
                ))
                .unwrap(),
                1
            );
            repo.hide("first").unwrap();
            assert!(!HistoryRepository::new(db).delete("first").unwrap());
        }
        {
            let db = Database::open(&path).unwrap();
            for id in ["first", "sibling", "version"] {
                assert_eq!(get(&db, id).unwrap().as_deref(), Some(image));
            }
            assert_eq!(get(&db, "absent").unwrap(), None);
        }
        std::fs::remove_file(path).unwrap();
    }
}
