//! Stable, display-only grouping across batches. No title/path similarity matching.
use crate::domain::{
    download::{DownloadGroup, DownloadGroupHint, DownloadGroupKind, DownloadOptions},
    error::{AppError, ErrorCode},
};

pub fn make(
    source: &str,
    hint: Option<&DownloadGroupHint>,
    index: Option<u32>,
    part_index: Option<u32>,
) -> Result<DownloadGroup, AppError> {
    if source.len() > 4096
        || hint.is_some_and(|h| h.title.trim().is_empty() || h.title.chars().count() > 1024)
    {
        return Err(invalid());
    }
    let mut url = reqwest::Url::parse(source).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err(invalid());
    }
    let host = url.host_str().unwrap().to_owned();
    let path = url.path().trim_end_matches('/').to_owned();
    let params: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    if ["sid", "list"]
        .iter()
        .any(|key| params.iter().filter(|(k, _)| k == key).count() > 1)
    {
        return Err(invalid());
    }
    let bv = path.strip_prefix("/video/").filter(|id| {
        id.len() == 12 && id.starts_with("BV") && id.bytes().all(|b| b.is_ascii_alphanumeric())
    });
    let bili = matches!(
        host.as_str(),
        "bilibili.com" | "www.bilibili.com" | "m.bilibili.com" | "space.bilibili.com"
    );
    let kind = hint.map(|h| h.kind).unwrap_or(if bili && bv.is_some() {
        DownloadGroupKind::Multipart
    } else {
        DownloadGroupKind::Collection
    });
    if bili
        && kind == DownloadGroupKind::Multipart
        && let Some(bv) = bv
    {
        url = reqwest::Url::parse(&format!("https://www.bilibili.com/video/{bv}"))
            .map_err(|_| invalid())?;
    } else if host == "space.bilibili.com"
        && path.ends_with("/channel/collectiondetail")
        && let Some((_, sid)) = params
            .iter()
            .find(|(k, v)| k == "sid" && !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
    {
        url.set_scheme("https").map_err(|_| invalid())?;
        url.set_path(&path);
        url.set_query(None);
        url.set_fragment(None);
        url.query_pairs_mut().append_pair("sid", sid);
    } else if matches!(
        host.as_str(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be"
    ) && let Some((_, list)) = params.iter().find(|(k, v)| k == "list" && !v.is_empty())
    {
        url = reqwest::Url::parse("https://www.youtube.com/playlist").unwrap();
        url.query_pairs_mut().append_pair("list", list);
    } else {
        let mut query: Vec<_> = params
            .into_iter()
            .filter(|(k, _)| {
                !k.starts_with("utm_")
                    && !(bili && matches!(k.as_str(), "spm_id_from" | "vd_source" | "trackid"))
            })
            .collect();
        let unique: std::collections::HashSet<_> = query.iter().map(|(k, _)| k).collect();
        if unique.len() == query.len() {
            query.sort();
        }
        url.set_query(None);
        if !query.is_empty() {
            url.query_pairs_mut().extend_pairs(query);
        }
    }
    let prefix = match kind {
        DownloadGroupKind::Collection => "collection",
        DownloadGroupKind::Multipart => "multipart",
    };
    Ok(DownloadGroup {
        key: format!("{prefix}:{url}"),
        title: hint.map_or_else(
            || url.as_str().chars().take(1024).collect(),
            |h| h.title.trim().to_owned(),
        ),
        source_url: source.into(),
        kind,
        item_index: index,
        part_index,
    })
}

/// Legacy rows are inferred only from explicit persisted playlist/part context, never a title or output path.
pub fn infer(options: &DownloadOptions) -> Option<DownloadGroup> {
    if let Some(group) = &options.group {
        return Some(group.clone());
    }
    if let Some(part) = &options.playlist_part {
        return make(
            &part.source_url,
            Some(&DownloadGroupHint {
                title: part.collection_title.clone(),
                kind: DownloadGroupKind::Collection,
            }),
            Some(part.parent_index),
            Some(part.part_index),
        )
        .ok();
    }
    if options.playlist_items.is_none() && options.playlist_item_count.is_none() {
        return None;
    }
    make(
        &options.url,
        None,
        options
            .playlist_items
            .as_ref()
            .filter(|v| v.len() == 1)
            .map(|v| v[0]),
        None,
    )
    .ok()
}
fn invalid() -> AppError {
    AppError::new(
        ErrorCode::InvalidUrl,
        "无法读取有效的合集分组信息，请重新解析。",
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_identities_merge_tracking_and_parts_but_not_other_sources() {
        let a=make("https://space.bilibili.com/306979414/channel/collectiondetail?sid=6546672&spm_id_from=one",None,Some(1),None).unwrap();
        let b=make("https://space.bilibili.com/306979414/channel/collectiondetail?spm_id_from=two&sid=6546672",None,Some(17),None).unwrap();
        assert_eq!(a.key, b.key);
        assert_ne!(
            a.key,
            make(
                "https://space.bilibili.com/306979414/channel/collectiondetail?sid=2",
                None,
                None,
                None
            )
            .unwrap()
            .key
        );
        assert_eq!(
            make(
                "https://www.bilibili.com/video/BV1uVy7BCErV?p=1",
                None,
                None,
                None
            )
            .unwrap()
            .key,
            make(
                "http://m.bilibili.com/video/BV1uVy7BCErV/?p=2&vd_source=test",
                None,
                None,
                None
            )
            .unwrap()
            .key
        );
        assert_eq!(
            make(
                "https://youtube.com/watch?v=first&list=PL1",
                None,
                None,
                None
            )
            .unwrap()
            .key,
            make(
                "https://www.youtube.com/playlist?list=PL1",
                None,
                None,
                None
            )
            .unwrap()
            .key
        );
        assert_ne!(
            make("https://a.example/list?id=1", None, None, None)
                .unwrap()
                .key,
            make("https://b.example/list?id=1", None, None, None)
                .unwrap()
                .key
        );
        assert_ne!(
            make("https://a.example/#/list/1", None, None, None)
                .unwrap()
                .key,
            make("https://a.example/#/list/2", None, None, None)
                .unwrap()
                .key
        );
        assert!(make("https://name:secret@example.com/list", None, None, None).is_err());
    }
    #[test]
    fn ordinary_single_video_is_not_inferred_as_a_collection() {
        assert!(
            infer(&DownloadOptions {
                url: "https://www.bilibili.com/video/BV1uVy7BCErV".into(),
                ..Default::default()
            })
            .is_none()
        );
    }

    #[test]
    fn group_persists_across_batches_history_reopen_and_hidden_tasks() {
        use crate::domain::download::{DownloadResult, DownloadTask, DownloadTaskStatus};
        use crate::infrastructure::database::{
            Database,
            repositories::{DownloadTaskRepository, HistoryRepository},
        };
        let path = std::env::temp_dir().join(format!(
            "savebeam-groups-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let db = Database::open(&path).unwrap();
            let tasks = DownloadTaskRepository::new(db.clone());
            let history = HistoryRepository::new(db);
            for (n, url) in [
                (
                    1,
                    "https://space.bilibili.com/306979414/channel/collectiondetail?sid=6546672&spm_id_from=old",
                ),
                (
                    17,
                    "https://space.bilibili.com/306979414/channel/collectiondetail?sid=6546672&spm_id_from=new",
                ),
            ] {
                let group = make(
                    url,
                    Some(&DownloadGroupHint {
                        title: "合集真实名称".into(),
                        kind: DownloadGroupKind::Collection,
                    }),
                    Some(n),
                    None,
                )
                .unwrap();
                let task = DownloadTask {
                    id: n.to_string(),
                    url: url.into(),
                    title: format!("视频{n}"),
                    format_id: "v+a".into(),
                    status: DownloadTaskStatus::Completed,
                    created_at_unix_ms: u64::from(n),
                    group: Some(group.clone()),
                };
                tasks
                    .insert(
                        &task,
                        &DownloadOptions {
                            url: url.into(),
                            title: task.title.clone(),
                            group: Some(group),
                            playlist_items: Some(vec![n]),
                            playlist_item_count: Some(1),
                            ..Default::default()
                        },
                    )
                    .unwrap();
                history
                    .insert(
                        &DownloadResult {
                            task_id: task.id.clone(),
                            title: task.title,
                            output_paths: vec![format!("/fixture/{n}.mp4")],
                            total_bytes: u64::from(n),
                        },
                        u64::from(n),
                    )
                    .unwrap();
            }
            tasks.hide("1").unwrap();
        }
        {
            let db = Database::open(&path).unwrap();
            let tasks = DownloadTaskRepository::new(db.clone());
            let history = HistoryRepository::new(db);
            let rows = history.search("合集真实名称").unwrap();
            assert_eq!(rows.len(), 2);
            assert_eq!(
                rows[0].group.as_ref().unwrap().key,
                rows[1].group.as_ref().unwrap().key
            );
            assert_eq!(history.search("视频17").unwrap().len(), 1);
            assert_eq!(tasks.list_visible().unwrap().len(), 1);
            assert_eq!(tasks.get("17").unwrap().unwrap().0.group, rows[0].group);
            history.delete("1").unwrap();
            assert_eq!(history.list().unwrap().len(), 1);
            assert!(tasks.get("1").unwrap().is_some());
        }
        std::fs::remove_file(&path).unwrap();
    }
}
