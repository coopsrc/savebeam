//! Bounded flat-playlist snapshots and verified ID tracking.
use crate::{
    domain::error::{AppError, ErrorCode},
    infrastructure::{
        database::subscriptions::{SeriesSnapshot, SubscriptionEntry},
        process_supervisor::CompletedMedia,
    },
};
use serde_json::Value;
use std::{collections::HashSet, path::Path};

pub fn map_snapshot(raw: &Value) -> Result<SeriesSnapshot, AppError> {
    let invalid = || {
        AppError::new(
            ErrorCode::UnsupportedUrl,
            "此链接未返回可订阅的系列及稳定 ID。请使用系列/播放列表链接。",
            false,
        )
    };
    if raw["_type"] != "playlist" {
        return Err(invalid());
    }
    let id = raw["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 512)
        .ok_or_else(invalid)?;
    let entries = raw["entries"].as_array().ok_or_else(invalid)?;
    let mut seen_ids = HashSet::new();
    let mut seen_indices = HashSet::new();
    let mapped: Vec<_> = entries
        .iter()
        .take(1000)
        .enumerate()
        .filter_map(|(offset, entry)| {
            let id = entry_id(entry)?;
            let index = entry["playlist_index"]
                .as_u64()
                .unwrap_or((offset + 1) as u64);
            if !(1..=1000).contains(&index)
                || !seen_indices.insert(index)
                || !seen_ids.insert(id.clone())
            {
                return None;
            }
            Some(SubscriptionEntry {
                id,
                index: index as u32,
                title: entry["title"]
                    .as_str()
                    .unwrap_or("未命名视频")
                    .chars()
                    .take(1024)
                    .collect(),
                downloaded: false,
                is_new: false,
                available: entry["_type"] != "playlist"
                    && entry["availability"] != "private"
                    && entry["availability"] != "unavailable",
                task_status: None,
            })
        })
        .collect();
    Ok(SeriesSnapshot {
        source_id: format!(
            "{}:{id}",
            raw["extractor_key"].as_str().unwrap_or("playlist")
        ),
        title: raw["title"]
            .as_str()
            .unwrap_or("未命名系列")
            .chars()
            .take(1024)
            .collect(),
        truncated: entries.len() > 1000
            || mapped.len() < entries.len().min(1000)
            || raw["playlist_count"]
                .as_u64()
                .is_some_and(|total| total > entries.len() as u64),
        entries: mapped,
    })
}

fn entry_id(entry: &Value) -> Option<String> {
    // Bilibili multipart flat entries can omit IDs (or expose only the common BV).
    // Its extractor's final ID is BV..._pN; derive it only from a verified public URL shape.
    if let Some(url) = entry["url"]
        .as_str()
        .and_then(|value| reqwest::Url::parse(value).ok())
        && matches!(url.host_str(), Some("www.bilibili.com" | "bilibili.com"))
        && let Some(bv) = url
            .path()
            .strip_prefix("/video/")
            .map(|path| path.trim_end_matches('/'))
        && bv.starts_with("BV")
        && bv.bytes().all(|byte| byte.is_ascii_alphanumeric())
        && let Some(part) = url
            .query_pairs()
            .find(|(name, _)| name == "p")
            .and_then(|(_, value)| value.parse::<u32>().ok())
            .filter(|part| *part > 0)
    {
        return Some(format!("{bv}_p{part}"));
    }
    entry["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 512)
        .map(str::to_owned)
}

/// Only IDs whose after_move path is one of the independently verified final files count.
pub fn verified_ids(
    items: &[CompletedMedia],
    paths: &[String],
    expected: Option<&str>,
) -> Result<Vec<String>, AppError> {
    let ids: Vec<String> = items
        .iter()
        .filter(|item| {
            Path::new(&item.path)
                .canonicalize()
                .ok()
                .is_some_and(|path| paths.iter().any(|verified| Path::new(verified) == path))
        })
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    if expected.is_some_and(|expected| ids.len() != 1 || ids[0] != expected) {
        return Err(AppError::new(
            ErrorCode::VideoUnavailable,
            "系列顺序或条目已变更；未确认目标视频下载成功。请检查订阅更新后重新选择。",
            true,
        ));
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn subscription_scan_keeps_positions_beyond_fifty_and_reports_incomplete_results() {
        let mut raw = json!({"_type":"playlist", "id":"list", "entries": (1..=1001).map(|index| json!({"id":format!("v{index}"),"playlist_index":index,"title":"Lesson"})).collect::<Vec<_>>()});
        let result = map_snapshot(&raw).unwrap();
        assert!(result.truncated);
        assert_eq!(result.entries.len(), 1000);
        assert_eq!(result.entries[999].index, 1000);
        raw["entries"] =
            json!([{"id":"v", "playlist_index": 72}, null, {"id":"v", "playlist_index":74}]);
        let result = map_snapshot(&raw).unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].index, 72);
        assert!(result.truncated);
        raw["_type"] = json!("video");
        assert!(map_snapshot(&raw).is_err());
    }

    #[test]
    fn derives_distinct_bilibili_multipart_ids_without_trusting_other_hosts() {
        let raw = json!({"_type":"playlist", "id":"BV123", "entries":[
            {"id":"BV123", "url":"https://www.bilibili.com/video/BV123?p=1"},
            {"url":"https://www.bilibili.com/video/BV123?p=2"},
            {"url":"https://evil.invalid/video/BV123?p=3"}
        ]});
        let result = map_snapshot(&raw).unwrap();
        assert_eq!(
            result
                .entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["BV123_p1", "BV123_p2"]
        );
        assert!(result.truncated);
    }

    #[test]
    fn completion_requires_matching_id_and_a_verified_final_path() {
        let directory = std::env::temp_dir().join(format!(
            "savebeam-sub-completion-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("final.mp4");
        std::fs::write(&file, b"fixture").unwrap();
        let path = file.canonicalize().unwrap().to_string_lossy().into_owned();
        let records = vec![CompletedMedia {
            source: None,
            id: "target".into(),
            path: path.clone(),
        }];
        assert_eq!(
            verified_ids(&records, std::slice::from_ref(&path), Some("target")).unwrap(),
            ["target"]
        );
        assert!(verified_ids(&records, &[], Some("target")).is_err());
        assert!(verified_ids(&records, &[path], Some("different")).is_err());
        assert!(verified_ids(&[], &[], Some("target")).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
