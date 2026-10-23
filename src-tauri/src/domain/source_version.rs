//! Evidence is deliberately metadata-only: never persist signed URLs, cookies or headers.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceObservation {
    pub media_id: String,
    pub extractor: Option<String>,
    pub duration_seconds: Option<u64>,
    pub modified_timestamp: Option<u64>,
    pub revision_id: Option<String>,
    pub formats_digest: Option<String>,
}

pub fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value
            .chars()
            .all(|c| c.is_alphanumeric() || "_.-".contains(c))
}

impl SourceObservation {
    pub fn from_raw(raw: &Value) -> Option<Self> {
        let id = raw.get("id")?.as_str()?.to_owned();
        if !safe_id(&id) {
            return None;
        }
        let mut formats = Vec::new();
        let source_formats = raw.get("formats").and_then(Value::as_array);
        if let Some(source_formats) = source_formats.filter(|items| items.len() <= 512) {
            for format in source_formats {
                let mut projected = serde_json::Map::new();
                for key in [
                    "format_id",
                    "ext",
                    "vcodec",
                    "acodec",
                    "width",
                    "height",
                    "fps",
                    "filesize",
                ] {
                    if let Some(value) = format.get(key).filter(|v| {
                        v.is_number()
                            || v.as_str().is_some_and(|s| {
                                s.len() <= 128 && !s.contains(['?', '/', '\\', '\n'])
                            })
                    }) {
                        projected.insert(key.into(), value.clone());
                    }
                }
                if !projected.is_empty() {
                    formats.push(Value::Object(projected).to_string());
                }
            }
        }
        formats.sort();
        formats.dedup();
        Some(Self {
            media_id: id,
            extractor: raw
                .get("extractor_key")
                .and_then(Value::as_str)
                .filter(|s| safe_id(s))
                .map(str::to_owned),
            duration_seconds: raw
                .get("duration")
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n > 0.0 && *n < 1e9)
                .map(|n| n.round() as u64),
            modified_timestamp: raw
                .get("modified_timestamp")
                .and_then(Value::as_u64)
                .filter(|n| *n > 0),
            revision_id: raw
                .get("cid")
                .filter(|v| v.is_number() || v.as_str().is_some_and(safe_id))
                .map(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| v.to_string())
                }),
            formats_digest: (!formats.is_empty())
                .then(|| hex::encode(Sha256::digest(json!(formats).to_string().as_bytes()))),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceComparison {
    pub status: String,
    pub reasons: Vec<String>,
}

pub fn compare(old: Option<&SourceObservation>, new: &SourceObservation) -> SourceComparison {
    let Some(old) = old else {
        return SourceComparison {
            status: "unknown".into(),
            reasons: vec!["旧下载缺少来源基线，无法判断是否换源。".into()],
        };
    };
    if old.media_id != new.media_id
        || matches!((&old.extractor, &new.extractor), (Some(a), Some(b)) if a != b)
    {
        return SourceComparison {
            status: "identity_changed".into(),
            reasons: vec!["链接返回的媒体标识已改变；为防止下载错条目，请重新解析来源。".into()],
        };
    }
    let pairs = [
        (
            old.duration_seconds.map(|n| n.to_string()),
            new.duration_seconds.map(|n| n.to_string()),
            "时长发生变化",
        ),
        (
            old.modified_timestamp.map(|n| n.to_string()),
            new.modified_timestamp.map(|n| n.to_string()),
            "来源修改时间发生变化",
        ),
        (
            old.revision_id.clone(),
            new.revision_id.clone(),
            "站点修订标识发生变化",
        ),
        (
            old.formats_digest.clone(),
            new.formats_digest.clone(),
            "可用源格式信息发生变化",
        ),
    ];
    let mut compared = false;
    let mut reasons = Vec::new();
    for (a, b, reason) in pairs {
        if let (Some(a), Some(b)) = (a, b) {
            compared = true;
            if a != b {
                reasons.push(reason.to_owned());
            }
        }
    }
    let status = if !reasons.is_empty() {
        "possible_change"
    } else if compared {
        "no_obvious_change"
    } else {
        "unknown"
    };
    if reasons.is_empty() {
        reasons.push(
            if compared {
                "可比较元数据没有明显变化，不代表视频内容一定相同。"
            } else {
                "可比较元数据不足，无法判断是否换源。"
            }
            .into(),
        );
    }
    SourceComparison {
        status: status.into(),
        reasons,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionFile {
    pub path: String,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaVersion {
    pub task_id: String,
    pub root_task_id: String,
    pub parent_task_id: Option<String>,
    pub version_number: u32,
    pub completed_at_unix_ms: u64,
    pub source: Option<SourceObservation>,
    pub files: Vec<VersionFile>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_urls_order_and_title_do_not_change_the_evidence() {
        let a = json!({"id":"BV123", "duration":10, "title":"old", "formats":[{"format_id":"1", "url":"https://a/?token=secret", "vcodec":"avc1"}, {"format_id":"2"}]});
        let b = json!({"id":"BV123", "duration":10, "title":"new", "http_headers":{"Cookie":"secret"}, "formats":[{"format_id":"2"}, {"format_id":"1", "url":"https://b/?token=rotated", "vcodec":"avc1"}]});
        let old = SourceObservation::from_raw(&a).unwrap();
        let new = SourceObservation::from_raw(&b).unwrap();
        assert_eq!(old, new);
        assert!(!serde_json::to_string(&new).unwrap().contains("secret"));
        assert_eq!(compare(Some(&old), &new).status, "no_obvious_change");
        assert_eq!(compare(None, &new).status, "unknown");
    }
    #[test]
    fn metadata_changes_are_only_suspicions_and_identity_mismatch_is_distinct() {
        let old = SourceObservation::from_raw(&json!({"id":"a", "duration":10})).unwrap();
        let changed = SourceObservation::from_raw(&json!({"id":"a", "duration":20})).unwrap();
        assert_eq!(compare(Some(&old), &changed).status, "possible_change");
        let other = SourceObservation::from_raw(&json!({"id":"b", "duration":20})).unwrap();
        assert_eq!(compare(Some(&old), &other).status, "identity_changed");
    }
}
