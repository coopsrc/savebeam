//! Bounded, one-level Bilibili multipart expansion. Never pass an outer selector into a part list.
use super::{
    playlist_quality::{PlaylistDetails, map_details},
    playlist_size::PlaylistSizeRequestItem,
};
use crate::{
    domain::{
        download::{CookiePreferences, PlaylistPartContext},
        error::{AppError, ErrorCode},
    },
    infrastructure::ytdlp_process::YtDlpProcessEngine,
};
use serde_json::Value;

pub fn parent_url(id: &str) -> String {
    format!("https://www.bilibili.com/video/{id}/")
}

/// yt-dlp omits playlist_index on nested playlist objects. Its root requested_entries
/// is an explicit positional mapping, not a guessed compact-array offset.
pub fn at_position(raw: &Value, offset: usize, entry: &Value, index: u32) -> bool {
    if let Some(position) = entry["playlist_index"].as_u64() {
        return position == u64::from(index);
    }
    if entry["_type"] != "playlist" {
        return false;
    }
    let (Some(positions), Some(entries)) = (
        raw["requested_entries"].as_array(),
        raw["entries"].as_array(),
    ) else {
        return false;
    };
    let indices = positions
        .iter()
        .filter_map(Value::as_u64)
        .collect::<std::collections::BTreeSet<_>>();
    positions.len() == entries.len()
        && indices.len() == positions.len()
        && positions.get(offset).and_then(Value::as_u64) == Some(u64::from(index))
}

pub fn validate(p: &PlaylistPartContext) -> Result<(), AppError> {
    let url = reqwest::Url::parse(&p.source_url).ok();
    let valid_source = url.as_ref().is_some_and(|u| {
        matches!(u.scheme(), "http" | "https")
            && u.host_str()
                .is_some_and(|h| h == "bilibili.com" || h.ends_with(".bilibili.com"))
            && u.username().is_empty()
            && u.password().is_none()
    });
    if !valid_source
        || p.source_url.len() > 4096
        || p.parent_id.len() != 12
        || !p.parent_id.starts_with("BV")
        || !p.parent_id.bytes().all(|b| b.is_ascii_alphanumeric())
        || !(1..=1000).contains(&p.parent_index)
        || !(1..=50).contains(&p.part_count)
        || !(1..=p.part_count).contains(&p.part_index)
        || p.collection_id.is_empty()
        || p.collection_id.len() > 512
        || p.collection_id.contains('\0')
        || p.collection_title.trim().is_empty()
        || p.collection_title.chars().count() > 1024
        || p.collection_title.contains('\0')
    {
        return Err(AppError::new(
            ErrorCode::InvalidPath,
            "合集分 P 上下文无效，请重新解析。",
            false,
        ));
    }
    Ok(())
}

/// Inspect only independently scoped direct parent URLs. Supports the concrete Bilibili anthology
/// shape, not arbitrary recursive playlists or externally supplied redirect URLs.
pub fn expand(
    engine: &YtDlpProcessEngine,
    cookies: &CookiePreferences,
    source_url: &str,
    raw: &Value,
    requested: &[PlaylistSizeRequestItem],
    rows: &mut [PlaylistDetails],
) {
    for (item, row) in requested.iter().zip(rows.iter_mut()) {
        let parents: Vec<_> = raw
            .get("entries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
            .filter(|(offset, e)| at_position(raw, *offset, e, item.index))
            .map(|(_, e)| e)
            .collect();
        let Some(parent) = (parents.len() == 1).then(|| parents[0]) else {
            continue;
        };
        if parent["_type"].as_str() != Some("playlist") {
            continue;
        }
        let Some(id) = parent["id"]
            .as_str()
            .filter(|id| Some(*id) == item.id.as_deref())
        else {
            continue;
        };
        let mut context = PlaylistPartContext {
            source_url: source_url.into(),
            collection_id: raw["id"].as_str().unwrap_or_default().into(),
            collection_title: raw["title"]
                .as_str()
                .unwrap_or_default()
                .chars()
                .take(1024)
                .collect(),
            parent_id: id.into(),
            parent_index: item.index,
            part_index: 1,
            part_count: 1,
        };
        if validate(&context).is_err() {
            row.error =
                Some("该条目是嵌套列表，当前仅支持哔哩哔哩合集内分 P；请单独解析条目链接。".into());
            continue;
        }
        let result = (|| -> Result<Vec<PlaylistDetails>, AppError> {
            // Discover count without applying the collection index; flat metadata is bounded to 51.
            let direct = parent_url(id);
            let listing = engine.inspect_with_cookies(&direct, cookies)?;
            if listing["id"].as_str() != Some(id) {
                return Err(unavailable("分 P 视频 ID 已变化，请重新解析。"));
            }
            let children = listing["entries"]
                .as_array()
                .ok_or_else(|| unavailable("分 P 列表未返回，请重试。"))?;
            if children.is_empty()
                || children.len() > 50
                || listing["playlist_count"].as_u64().is_some_and(|n| n > 50)
            {
                return Err(unavailable(
                    "分 P 超过 50 项或列表为空，请单独解析链接分批下载。",
                ));
            }
            context.part_count = children.len() as u32;
            if children.iter().enumerate().any(|(offset, child)| {
                super::subscriptions::entry_id(child).as_deref()
                    != Some(&format!("{id}_p{}", offset + 1))
            }) {
                return Err(unavailable("分 P 清单身份或顺序不完整，请重新解析。"));
            }
            // Discover only. Full formats are fetched in separately stoppable batches of five.
            let parts = children
                .iter()
                .enumerate()
                .map(|(offset, child)| {
                    let part_index = offset as u32 + 1;
                    PlaylistDetails {
                        index: item.index * 1000 + part_index,
                        id: Some(format!("{id}_p{part_index}")),
                        title: child["title"]
                            .as_str()
                            .map(|s| s.chars().take(1024).collect()),
                        duration_seconds: child["duration"]
                            .as_f64()
                            .filter(|d| d.is_finite() && *d > 0.0),
                        formats: Vec::new(),
                        subtitles: Vec::new(),
                        error: None,
                        part: Some(PlaylistPartContext {
                            part_index,
                            ..context.clone()
                        }),
                        parts: Vec::new(),
                    }
                })
                .collect();
            Ok(parts)
        })();
        row.title = parent["title"]
            .as_str()
            .map(|s| s.chars().take(1024).collect());
        match result {
            Ok(parts) => {
                row.parts = parts;
                row.error = None;
            }
            Err(error) => {
                row.error = Some(error.message);
            }
        }
    }
}

pub fn inspect_parts(
    engine: &YtDlpProcessEngine,
    cookies: &CookiePreferences,
    parts: &[PlaylistPartContext],
) -> Result<Vec<PlaylistDetails>, AppError> {
    let Some(first) = parts.first() else {
        return Err(unavailable("请选择需要读取的分 P。"));
    };
    if parts.len() > 5 {
        return Err(unavailable("每次最多读取 5 个分 P。"));
    }
    let mut indices = std::collections::BTreeSet::new();
    for part in parts {
        validate(part)?;
        let mut comparable = part.clone();
        comparable.part_index = first.part_index;
        if &comparable != first || !indices.insert(part.part_index) {
            return Err(unavailable("请按同一视频的分 P 分批读取。"));
        }
    }
    let wanted = parts
        .iter()
        .map(|p| PlaylistSizeRequestItem {
            index: p.part_index,
            id: Some(format!("{}_p{}", p.parent_id, p.part_index)),
        })
        .collect::<Vec<_>>();
    let raw = engine
        .clone()
        .for_size_estimate(&indices.into_iter().collect::<Vec<_>>())?
        .inspect_with_cookies(&parent_url(&first.parent_id), cookies)?;
    let mut rows = map_details(&raw, &wanted);
    for (row, part) in rows.iter_mut().zip(parts) {
        row.index = part.parent_index * 1000 + part.part_index;
        row.part = Some(part.clone());
    }
    Ok(rows)
}

fn unavailable(message: &str) -> AppError {
    AppError::new(ErrorCode::VideoUnavailable, message, true)
}

pub fn output_template(p: &PlaylistPartContext) -> Result<String, AppError> {
    validate(p)?;
    Ok(format!(
        "%(playlist_title)s%(playlist_id& [{{}}]|)s/{}-P{}-%(title)s%(id& [{{}}]|)s.%(ext)s",
        p.parent_index, p.part_index
    ))
}

/// Set collection naming fields before filename sanitization. Values are literal regex
/// replacements (escaped backslashes), never template fragments or command strings.
pub fn naming_args(p: &PlaylistPartContext) -> Vec<std::ffi::OsString> {
    [
        ("playlist_title", &p.collection_title),
        ("playlist_id", &p.collection_id),
    ]
    .into_iter()
    .flat_map(|(field, value)| {
        [
            "--replace-in-metadata".into(),
            field.into(),
            r"\A[\s\S]*\Z".into(),
            value.replace('\\', "\\\\").into(),
        ]
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        domain::{
            download::{DownloadOptions, DownloadTaskStatus},
            download_defaults::DownloadOptionDefaults,
        },
        infrastructure::database::{
            Database,
            repositories::DownloadTaskRepository,
            subscriptions::{SeriesSnapshot, SubscriptionEntry, SubscriptionRepository},
        },
        services::{
            download_registry::DownloadTaskRegistry,
            playlist_quality::{task_options, validate_request},
        },
    };
    use serde_json::json;

    fn context(index: u32) -> PlaylistPartContext {
        PlaylistPartContext {
            source_url: "https://space.bilibili.com/306979414/channel/collectiondetail?sid=6546672"
                .into(),
            collection_id: "306979414_6546672".into(),
            collection_title: "合集·1973年 恶魔 Z 修复合集".into(),
            parent_id: "BV1uVy7BCErV".into(),
            parent_index: 13,
            part_index: index,
            part_count: 2,
        }
    }

    fn part(index: u32) -> PlaylistDetails {
        let p = context(index);
        PlaylistDetails {
            index: 13000 + index,
            id: Some(format!("{}_p{index}", p.parent_id)),
            title: Some(format!("第 {index} P")),
            duration_seconds: Some(10.0),
            formats: crate::services::media_mapper::map_formats(
                Some(&json!([
                    {"format_id":"v","ext":"mp4","vcodec":"hevc","acodec":"none","height":1080,"filesize":100},
                    {"format_id":"a","ext":"m4a","vcodec":"none","acodec":"aac","abr":128,"filesize":20}
                ])),
                Some(10.0),
            ),
            subtitles: Vec::new(),
            error: None,
            part: Some(p),
            parts: Vec::new(),
        }
    }

    #[test]
    fn independent_parts_keep_options_across_database_reopen_cancel_retry_and_version_download() {
        let dir = std::env::temp_dir().join(format!(
            "savebeam-parts-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let db_path = dir.join("tasks.sqlite3");
        let item = part(2);
        let policy = crate::domain::playlist_quality::PlaylistQuality {
            automatic_recommendations: true,
            ..Default::default()
        };
        validate_request(std::slice::from_ref(&item), &policy, &[]).unwrap();
        let mut options = task_options(
            &context(2).source_url,
            &item,
            &policy,
            &DownloadOptionDefaults {
                keep_intermediate_files: true,
                write_thumbnail: true,
                ..Default::default()
            },
            true,
        )
        .unwrap();
        options.output_directory = dir.to_string_lossy().into();
        assert_eq!(options.playlist_items, Some(vec![2]));
        assert_eq!(options.url, parent_url("BV1uVy7BCErV"));
        let id;
        {
            let registry = DownloadTaskRegistry::default();
            registry
                .initialize_from_database(Database::open(&db_path).unwrap())
                .unwrap();
            let task = registry.create(options.clone()).unwrap();
            id = task.id;
            registry
                .transition(&id, DownloadTaskStatus::Preparing)
                .unwrap();
            registry.cancel(&id).unwrap();
        }
        {
            let db = Database::open(&db_path).unwrap();
            let registry = DownloadTaskRegistry::default();
            registry.initialize_from_database(db.clone()).unwrap();
            assert_eq!(
                DownloadTaskRepository::new(db).get(&id).unwrap().unwrap().1,
                options
            );
            let retry = registry.retry(&id).unwrap().1;
            assert_eq!(retry, options);
            let args =
                crate::security::download_args::build_download_args(&retry, &Default::default())
                    .unwrap()
                    .into_iter()
                    .map(|a| a.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
            assert!(args.windows(2).any(|a| a == ["--playlist-items", "2"]));
            assert!(args.iter().any(|a| a.contains("/13-P2-%(title)s")));
            assert!(!args.iter().any(|a| a == "13002" || a == "13"));
            assert!(args.iter().any(|a| a == &context(2).collection_title));
            let raw = json!({"id":"BV1uVy7BCErV_p2","title":"更新源", "duration":10, "formats":[{"format_id":"new","ext":"mp4","vcodec":"hevc","acodec":"aac","height":1080}]});
            let source = crate::domain::source_version::SourceObservation::from_raw(&raw).unwrap();
            let version = crate::services::source_versions::prepare_version_options(
                retry,
                &id,
                false,
                &source,
                "更新源".into(),
                &raw,
            )
            .unwrap();
            assert_eq!(version.playlist_part, options.playlist_part);
            assert_eq!(version.playlist_items, Some(vec![2]));
            assert_eq!(version.format_id, "new");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn part_ledger_marks_parent_only_after_every_part_and_survives_subscription_refresh() {
        let db = Database::open_in_memory().unwrap();
        let repo = SubscriptionRepository(db);
        let p = context(1);
        let snapshot = SeriesSnapshot {
            source_id: "list".into(),
            title: "合集".into(),
            truncated: false,
            entries: vec![SubscriptionEntry {
                id: p.parent_id.clone(),
                index: 13,
                title: "视频".into(),
                duration_seconds: None,
                downloaded: false,
                is_new: false,
                available: true,
                task_status: None,
            }],
        };
        let id = repo.apply(&p.source_url, &snapshot, 1).unwrap();
        let mut options = DownloadOptions {
            playlist_part: Some(p.clone()),
            ..Default::default()
        };
        repo.mark_task_downloaded(&options, &[format!("{}_p1", p.parent_id)])
            .unwrap();
        repo.apply(&p.source_url, &snapshot, 2).unwrap();
        assert!(!repo.get(id).unwrap().entries[0].downloaded);
        options.playlist_part = Some(context(2));
        repo.mark_task_downloaded(&options, &[format!("{}_p2", p.parent_id)])
            .unwrap();
        repo.apply(&p.source_url, &snapshot, 3).unwrap();
        assert!(repo.get(id).unwrap().entries[0].downloaded);
    }

    #[test]
    fn rejects_wrong_hosts_part_ranges_identity_and_recursive_expansion() {
        let policy = Default::default();
        for change in 0..5 {
            let mut item = part(1);
            match change {
                0 => {
                    item.part.as_mut().unwrap().source_url =
                        "https://bilibili.com.evil.invalid/".into()
                }
                1 => item.part.as_mut().unwrap().part_index = 3,
                2 => item.id = Some("wrong_p1".into()),
                3 => item.index = 13,
                _ => item.parts = vec![part(2)],
            }
            assert!(validate_request(&[item], &policy, &[]).is_err());
        }
        let mut p = context(1);
        p.collection_title = "../%(title)s/源\\1\n".into();
        let template = output_template(&p).unwrap();
        assert!(!template.contains(&p.collection_title));
        let args = naming_args(&p);
        assert_eq!(args[3], "../%(title)s/源\\\\1\n");
    }

    #[cfg(unix)]
    #[test]
    fn nested_parent_is_discovered_without_outer_selector_then_formats_use_only_part_indices() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "savebeam-part-engine-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let exe = dir.join("yt-dlp");
        std::fs::write(&exe, r##"#!/bin/sh
flat=0
selector=''
next=0
for arg in "$@"; do
  [ "$next" = 1 ] && selector="$arg" && next=0
  [ "$arg" = '--playlist-items' ] && next=1
  [ "$arg" = '--flat-playlist' ] && flat=1
done
[ "$arg" = 'https://www.bilibili.com/video/BV1uVy7BCErV/' ] || exit 11
if [ "$flat" = 1 ]; then
  [ -z "$selector" ] || exit 12
  printf '%s' '{"id":"BV1uVy7BCErV","_type":"playlist","playlist_count":2,"entries":[{"url":"https://www.bilibili.com/video/BV1uVy7BCErV?p=1"},{"url":"https://www.bilibili.com/video/BV1uVy7BCErV?p=2"}]}'
else
  [ "$selector" = '1,2' ] || exit 13
  printf '%s' '{"entries":[{"playlist_index":1,"id":"BV1uVy7BCErV_p1","title":"解说版","formats":[]},{"playlist_index":2,"id":"BV1uVy7BCErV_p2","title":"纯享版","formats":[]}]}'
fi
"##).unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        let engine = YtDlpProcessEngine::new(exe, None);
        let raw = json!({"id":"306979414_6546672","title":"合集", "requested_entries":[13], "entries":[{"id":"BV1uVy7BCErV","_type":"playlist","title":"避震特别篇","entries":[]}]});
        let wanted = [PlaylistSizeRequestItem {
            index: 13,
            id: Some("BV1uVy7BCErV".into()),
        }];
        let mut rows = map_details(&raw, &wanted);
        expand(
            &engine,
            &Default::default(),
            &context(1).source_url,
            &raw,
            &wanted,
            &mut rows,
        );
        assert!(rows[0].error.is_none(), "{:?}", rows[0].error);
        assert_eq!(rows[0].parts.len(), 2);
        let contexts = rows[0]
            .parts
            .iter()
            .map(|p| p.part.clone().unwrap())
            .collect::<Vec<_>>();
        let detailed = inspect_parts(&engine, &Default::default(), &contexts).unwrap();
        assert_eq!(
            detailed.iter().map(|p| p.index).collect::<Vec<_>>(),
            [13001, 13002]
        );
        assert_eq!(detailed[0].title.as_deref(), Some("解说版"));
        assert_eq!(detailed[1].title.as_deref(), Some("纯享版"));
        let mut wrong = raw.clone();
        wrong["requested_entries"] = json!([12]);
        let mut invalid_rows = map_details(&wrong, &wanted);
        expand(
            &engine,
            &Default::default(),
            &context(1).source_url,
            &wrong,
            &wanted,
            &mut invalid_rows,
        );
        assert!(invalid_rows[0].parts.is_empty());
        assert!(
            inspect_parts(
                &engine,
                &Default::default(),
                &[contexts[0].clone(), contexts[0].clone()]
            )
            .is_err()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[ignore = "Opt-in public-site metadata check; needs SAVEBEAM_LIVE_YTDLP. Never downloads media or reads browser cookies."]
    fn live_bilibili_collection_part_metadata() {
        let engine = YtDlpProcessEngine::new(
            std::env::var("SAVEBEAM_LIVE_YTDLP").expect("Pass yt-dlp executable"),
            None,
        )
        .with_network_preferences(crate::domain::network::NetworkPreferences {
            proxy_mode: crate::domain::network::ProxyMode::Direct,
            proxy_url: String::new(),
        });
        let url = context(1).source_url;
        let wanted = [PlaylistSizeRequestItem {
            index: 13,
            id: Some("BV1uVy7BCErV".into()),
        }];
        let raw = engine
            .clone()
            .for_size_estimate(&[13])
            .unwrap()
            .inspect(&url)
            .unwrap();
        let mut rows = map_details(&raw, &wanted);
        expand(&engine, &Default::default(), &url, &raw, &wanted, &mut rows);
        assert!(rows[0].error.is_none(), "{:?}", rows[0].error);
        assert_eq!(rows[0].parts.len(), 2);
        let contexts = rows[0]
            .parts
            .iter()
            .map(|p| p.part.clone().unwrap())
            .collect::<Vec<_>>();
        let parts = inspect_parts(&engine, &Default::default(), &contexts).unwrap();
        assert_eq!(
            parts.iter().map(|p| p.index).collect::<Vec<_>>(),
            [13001, 13002]
        );
        for part in parts {
            assert!(part.error.is_none(), "{:?}", part.error);
            assert!(part.title.as_ref().is_some_and(|t| t.contains("特别篇")));
            assert!(!part.formats.is_empty());
            let choice = crate::services::playlist_quality::select(
                &part,
                &crate::domain::playlist_quality::PlaylistQuality {
                    automatic_recommendations: true,
                    ..Default::default()
                },
                false,
            );
            assert!(choice.format_id.is_some());
            assert!(choice.bytes.is_some());
        }
    }
}
