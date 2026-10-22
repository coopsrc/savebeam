//! Size-only projections of explicitly selected playlist positions. Never return media URLs.
use crate::domain::error::{AppError, ErrorCode};
pub use crate::security::playlist_indices::validate_indices;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

const MAX_SAFE_BYTES: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistSizeRequestItem {
    pub index: u32,
    pub id: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSizeItem {
    pub index: u32,
    pub id: Option<String>,
    pub bytes: Option<u64>,
}

#[derive(Clone, Default)]
pub struct PlaylistSizeOperations(Arc<AtomicBool>);
pub struct EstimateGuard(Arc<AtomicBool>);
impl Drop for EstimateGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
impl PlaylistSizeOperations {
    pub fn begin(&self) -> Result<EstimateGuard, AppError> {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                AppError::new(
                    ErrorCode::NetworkFailure,
                    "已有系列大小估算正在进行，请稍后重试。",
                    true,
                )
            })?;
        Ok(EstimateGuard(self.0.clone()))
    }
}

fn known_bytes(raw: &Value) -> Option<u64> {
    let from_field = |key| {
        raw.get(key)
            .and_then(Value::as_u64)
            .filter(|bytes| *bytes > 0 && *bytes <= MAX_SAFE_BYTES)
    };
    from_field("filesize")
        .or_else(|| from_field("filesize_approx"))
        .or_else(|| {
            super::media_mapper::estimate_format_bytes(
                raw,
                raw.get("duration").and_then(Value::as_f64),
            )
            .filter(|bytes| *bytes <= MAX_SAFE_BYTES)
        })
}

fn selected_bytes(raw: &Value, duration: Option<f64>, depth: u8) -> Option<u64> {
    if depth > 3 {
        return None;
    }
    for key in ["requested_formats", "requested_downloads"] {
        if let Some(streams) = raw
            .get(key)
            .and_then(Value::as_array)
            .filter(|items| !items.is_empty())
        {
            if streams.len() > 4 {
                return None;
            }
            let mut ids = BTreeSet::new();
            return streams.iter().try_fold(0u64, |total, stream| {
                if let Some(id) = stream.get("format_id").and_then(Value::as_str)
                    && !ids.insert(id)
                {
                    return None;
                }
                let size = if stream.get("requested_formats").is_some()
                    || stream.get("requested_downloads").is_some()
                {
                    selected_bytes(stream, duration, depth + 1)?
                } else {
                    known_bytes(stream)
                        .or_else(|| super::media_mapper::estimate_format_bytes(stream, duration))?
                };
                total.checked_add(size).filter(|sum| *sum <= MAX_SAFE_BYTES)
            });
        }
    }
    known_bytes(raw)
        .or_else(|| super::media_mapper::estimate_format_bytes(raw, duration))
        .filter(|bytes| *bytes > 0 && *bytes <= MAX_SAFE_BYTES)
}

pub fn map_sizes(raw: &Value, requested: &[PlaylistSizeRequestItem]) -> Vec<PlaylistSizeItem> {
    let entries = raw.get("entries").and_then(Value::as_array);
    requested
        .iter()
        .map(|item| {
            let candidates: Vec<_> = entries
                .into_iter()
                .flatten()
                .take(50)
                .filter(|entry| {
                    entry.get("playlist_index").and_then(Value::as_u64)
                        == Some(u64::from(item.index))
                })
                .collect();
            let entry = (candidates.len() == 1).then(|| candidates[0]);
            let id = entry
                .and_then(|entry| entry.get("id"))
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= 512)
                .map(str::to_owned);
            let bytes = entry
                .filter(|entry| entry.get("_type").and_then(Value::as_str) != Some("playlist"))
                .filter(|_| {
                    id.is_some()
                        && item
                            .id
                            .as_ref()
                            .is_none_or(|expected| Some(expected) == id.as_ref())
                })
                .and_then(|entry| {
                    selected_bytes(entry, entry.get("duration").and_then(Value::as_f64), 0)
                });
            PlaylistSizeItem {
                index: item.index,
                id,
                bytes,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn selected_streams_are_summed_muxed_counted_once_and_partial_or_changed_items_remain_unknown()
    {
        let raw = json!({"entries":[
            {"playlist_index":1,"id":"a","duration":10,"requested_formats":[{"format_id":"v","filesize":100},{"format_id":"a","filesize_approx":20}]},
            {"playlist_index":3,"id":"b","filesize":80},
            {"playlist_index":4,"id":"c","requested_formats":[{"filesize":100},{"format_id":"unknown"}]},
            {"playlist_index":5,"id":"changed","filesize":100},
            {"playlist_index":6,"id":"rate","duration":8,"requested_formats":[{"format_id":"v","vcodec":"avc1","acodec":"none","tbr":8},{"format_id":"a","vcodec":"none","acodec":"aac","abr":2}]}
        ]});
        let items = vec![
            (1, "a"),
            (3, "b"),
            (4, "c"),
            (5, "original"),
            (6, "rate"),
            (7, "missing"),
        ]
        .into_iter()
        .map(|(index, id)| PlaylistSizeRequestItem {
            index,
            id: Some(id.into()),
        })
        .collect::<Vec<_>>();
        let sizes = map_sizes(&raw, &items);
        assert_eq!(
            sizes.iter().map(|size| size.bytes).collect::<Vec<_>>(),
            [Some(120), Some(80), None, None, Some(10000), None]
        );
    }
    #[test]
    fn sparse_indices_are_not_renumbered_and_duplicate_nested_or_oversized_metadata_are_unknown() {
        let items = [PlaylistSizeRequestItem { index: 3, id: None }];
        for raw in [
            json!({"entries":[{"id":"no-index","filesize":100}]}),
            json!({"entries":[{"playlist_index":3,"id":"a","filesize":1},{"playlist_index":3,"id":"b","filesize":2}]}),
            json!({"entries":[{"playlist_index":3,"id":"nested","_type":"playlist","filesize":100}]}),
            json!({"entries":[{"playlist_index":3,"id":"big","filesize":u64::MAX}]}),
        ] {
            assert!(map_sizes(&raw, &items)[0].bytes.is_none());
        }
        for indices in [vec![], vec![1, 1], vec![0], vec![51]] {
            assert!(validate_indices(&indices).is_err());
        }
        assert_eq!(validate_indices(&[5, 1, 3]).unwrap(), [1, 3, 5]);
        let registry = PlaylistSizeOperations::default();
        let guard = registry.begin().unwrap();
        assert!(registry.begin().is_err());
        drop(guard);
        assert!(registry.begin().is_ok());
    }
}
