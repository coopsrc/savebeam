//! Pure, deterministic per-entry matching. Both preview and task creation call this code.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{media_mapper::map_formats, playlist_size::PlaylistSizeRequestItem};
use crate::domain::{
    download::MergeContainer,
    error::{AppError, ErrorCode},
    media::FormatOption,
    playlist_quality::PlaylistQuality,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistDetails {
    pub index: u32,
    pub id: Option<String>,
    pub title: Option<String>,
    pub duration_seconds: Option<f64>,
    pub formats: Vec<FormatOption>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QualityOverride {
    pub index: u32,
    pub policy: PlaylistQuality,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistMatch {
    pub index: u32,
    pub id: Option<String>,
    pub format_id: Option<String>,
    pub merge_container: Option<MergeContainer>,
    pub resolution: Option<String>,
    pub video_bitrate_kbps: Option<f64>,
    pub audio_bitrate_kbps: Option<f64>,
    pub bytes: Option<u64>,
    pub fallback_used: bool,
    pub error: Option<String>,
}

pub fn map_details(raw: &Value, requested: &[PlaylistSizeRequestItem]) -> Vec<PlaylistDetails> {
    requested
        .iter()
        .map(|item| {
            let matches: Vec<_> = raw
                .get("entries")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter(|entry| {
                    entry.get("playlist_index").and_then(Value::as_u64)
                        == Some(u64::from(item.index))
                })
                .collect();
            let entry = (matches.len() == 1).then(|| matches[0]);
            let id = entry
                .and_then(|entry| entry.get("id"))
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= 512);
            let valid = entry.is_some_and(|entry| {
                entry.get("_type").and_then(Value::as_str) != Some("playlist")
            }) && id.is_some()
                && item
                    .id
                    .as_deref()
                    .is_none_or(|expected| Some(expected) == id);
            let duration = entry
                .and_then(|entry| entry.get("duration"))
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n > 0.0);
            let mut formats = if valid {
                map_formats(entry.and_then(|entry| entry.get("formats")), duration)
            } else {
                Vec::new()
            };
            let unique: std::collections::BTreeSet<_> =
                formats.iter().map(|f| &f.format_id).collect();
            let format_error = formats.len() > 512 || unique.len() != formats.len();
            if format_error {
                formats.clear();
            }
            PlaylistDetails {
                index: item.index,
                id: if valid {
                    id.map(str::to_owned)
                } else {
                    item.id.clone()
                },
                title: if valid {
                    entry
                        .and_then(|entry| entry.get("title"))
                        .and_then(Value::as_str)
                        .filter(|title| !title.trim().is_empty())
                        .map(|title| title.chars().take(1024).collect())
                } else {
                    None
                },
                duration_seconds: duration,
                formats,
                error: if !valid {
                    Some("条目不可用、原始序号或视频 ID 已变化，请重新解析列表。".into())
                } else if format_error {
                    Some("格式过多或格式 ID 重复，无法安全固定下载格式。".into())
                } else {
                    None
                },
            }
        })
        .collect()
}

fn has_video(f: &FormatOption) -> bool {
    f.video_codec
        .as_deref()
        .is_some_and(|c| c != "none" && c != "images")
}
fn has_audio(f: &FormatOption) -> bool {
    f.audio_codec.as_deref().is_some_and(|c| c != "none")
}
fn bounded(value: Option<f64>, limit: Option<u32>) -> bool {
    limit.is_none_or(|limit| {
        value.is_some_and(|v| v.is_finite() && v > 0.0 && v <= f64::from(limit))
    })
}
fn video_allowed(f: &FormatOption, p: &PlaylistQuality) -> bool {
    let height = f.height.map(f64::from).or_else(|| {
        let resolution = f.resolution.as_deref()?;
        resolution
            .split('x')
            .next_back()?
            .trim_end_matches('p')
            .parse::<f64>()
            .ok()
    });
    bounded(height, p.max_height) && bounded(f.video_bitrate_kbps, p.max_video_bitrate_kbps)
}
fn container(v: &FormatOption, a: &FormatOption) -> MergeContainer {
    let v = v
        .video_codec
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let a = a
        .audio_codec
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let starts =
        |value: &str, prefixes: &[&str]| prefixes.iter().any(|prefix| value.starts_with(prefix));
    if starts(
        &v,
        &["avc", "h264", "hev", "hvc", "h265", "av01", "av1", "mpeg4"],
    ) && starts(
        &a,
        &["mp4a", "aac", "alac", "mp3", "ac3", "ac-3", "eac3", "eac-3"],
    ) {
        MergeContainer::Mp4
    } else if starts(&v, &["vp8", "vp08", "vp9", "vp09", "av01", "av1"])
        && starts(&a, &["opus", "vorbis"])
    {
        MergeContainer::Webm
    } else {
        MergeContainer::Mkv
    }
}
fn tracks<'a>(
    formats: &'a [FormatOption],
    p: &PlaylistQuality,
    audio_only: bool,
) -> Option<(&'a FormatOption, Option<&'a FormatOption>)> {
    let audio_ok =
        |f: &&FormatOption| has_audio(f) && bounded(f.audio_bitrate_kbps, p.max_audio_bitrate_kbps);
    if audio_only {
        return formats
            .iter()
            .rev()
            .filter(|f| !has_video(f))
            .find(audio_ok)
            .or_else(|| formats.iter().rev().find(audio_ok))
            .map(|a| (a, None));
    }
    let video = formats
        .iter()
        .rev()
        .find(|f| has_video(f) && !has_audio(f) && video_allowed(f, p));
    let audios: Vec<_> = formats
        .iter()
        .rev()
        .filter(|f| !has_video(f))
        .filter(audio_ok)
        .collect();
    if let Some(video) = video
        && !audios.is_empty()
    {
        let audio = audios
            .iter()
            .copied()
            .find(|audio| container(video, audio).extension() == video.extension)
            .unwrap_or(audios[0]);
        return Some((video, Some(audio)));
    }
    formats
        .iter()
        .rev()
        .find(|f| {
            has_video(f)
                && has_audio(f)
                && video_allowed(f, p)
                && bounded(f.audio_bitrate_kbps, p.max_audio_bitrate_kbps)
        })
        .map(|v| (v, None))
}
fn bytes(f: &FormatOption) -> Option<u64> {
    [f.file_size_bytes, f.approximate_file_size_bytes]
        .into_iter()
        .flatten()
        .find(|b| *b > 0 && *b <= 9_007_199_254_740_991)
}

pub fn select(item: &PlaylistDetails, policy: &PlaylistQuality, audio_only: bool) -> PlaylistMatch {
    let first = tracks(&item.formats, policy, audio_only);
    let fallback_used = first.is_none() && policy.allow_exceed;
    let matched = first.or_else(|| {
        policy
            .allow_exceed
            .then(|| tracks(&item.formats, &PlaylistQuality::default(), audio_only))
            .flatten()
    });
    let mut result = PlaylistMatch {
        index: item.index,
        id: item.id.clone(),
        format_id: None,
        merge_container: None,
        resolution: None,
        video_bitrate_kbps: None,
        audio_bitrate_kbps: None,
        bytes: None,
        fallback_used: false,
        error: item.error.clone(),
    };
    if item.error.is_some() {
        return result;
    }
    let Some((first, second)) = matched else {
        result.error =
            Some("没有符合上限的音视频组合，或缺少必要的规格信息；可单独调整或允许超限。".into());
        return result;
    };
    result.format_id = Some(second.map_or_else(
        || first.format_id.clone(),
        |a| format!("{}+{}", first.format_id, a.format_id),
    ));
    result.merge_container = second.map(|a| container(first, a));
    result.resolution = (!audio_only).then(|| first.resolution.clone()).flatten();
    result.video_bitrate_kbps = (!audio_only).then_some(first.video_bitrate_kbps).flatten();
    result.audio_bitrate_kbps = second.map_or(first.audio_bitrate_kbps, |a| a.audio_bitrate_kbps);
    result.bytes = if audio_only {
        None
    } else {
        bytes(first).and_then(|v| match second {
            Some(a) => v
                .checked_add(bytes(a)?)
                .filter(|b| *b <= 9_007_199_254_740_991),
            None => Some(v),
        })
    };
    result.fallback_used = fallback_used;
    result
}

pub fn validate_request(
    items: &[PlaylistDetails],
    policy: &PlaylistQuality,
    overrides: &[QualityOverride],
) -> Result<(), AppError> {
    super::playlist_size::validate_indices(
        &items.iter().map(|item| item.index).collect::<Vec<_>>(),
    )?;
    policy.validate()?;
    let mut indices = std::collections::BTreeSet::new();
    for over in overrides {
        over.policy.validate()?;
        if !indices.insert(over.index) || !items.iter().any(|item| item.index == over.index) {
            return Err(invalid());
        }
    }
    if items.iter().any(|item| {
        item.formats.len() > 512
            || item
                .title
                .as_ref()
                .is_some_and(|s| s.chars().count() > 1024)
            || item
                .id
                .as_ref()
                .is_none_or(|s| s.is_empty() || s.len() > 512)
            || item.formats.iter().any(|f| {
                f.format_id.is_empty()
                    || f.format_id.len() > 127
                    || f.format_id.starts_with('-')
                    || !f
                        .format_id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
            })
    }) {
        return Err(invalid());
    }
    Ok(())
}
fn invalid() -> AppError {
    AppError::new(
        ErrorCode::InvalidPath,
        "系列条目或单独画质设置无效，请重新解析。",
        false,
    )
}

pub fn effective<'a>(
    index: u32,
    common: &'a PlaylistQuality,
    overrides: &'a [QualityOverride],
) -> &'a PlaylistQuality {
    overrides
        .iter()
        .find(|value| value.index == index)
        .map_or(common, |value| &value.policy)
}

pub fn task_options(
    url: &str,
    item: &PlaylistDetails,
    policy: &PlaylistQuality,
    advanced: &crate::domain::download_defaults::DownloadOptionDefaults,
    use_proxy: bool,
) -> Option<crate::domain::download::DownloadOptions> {
    let choice = select(item, policy, advanced.audio_only);
    let mut options = crate::domain::download::DownloadOptions {
        title: item
            .title
            .clone()
            .filter(|title| !title.trim().is_empty())
            .unwrap_or_else(|| format!("第 {} 项", item.index)),
        url: url.into(),
        format_id: choice.format_id?,
        merge_container: choice.merge_container,
        playlist_item_count: Some(1),
        playlist_items: Some(vec![item.index]),
        expected_media_id: Some(item.id.clone()?),
        quality_policy: Some(policy.clone()),
        use_proxy: Some(use_proxy),
        ..Default::default()
    };
    advanced.apply_to(&mut options);
    Some(options)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn item(index: u32, height: u32) -> PlaylistDetails {
        PlaylistDetails {
            index,
            id: Some(format!("video-{index}")),
            title: Some(format!("课程 {index}")),
            duration_seconds: Some(10.0),
            error: None,
            formats: map_formats(
                Some(&json!([
                    {"format_id":"a128","ext":"m4a","acodec":"aac","vcodec":"none","abr":128,"filesize":10},
                    {"format_id":"a256","ext":"m4a","acodec":"aac","vcodec":"none","abr":256,"filesize":20},
                    {"format_id":"lower","ext":"mp4","vcodec":"avc1","acodec":"none","height":480,"vbr":1000,"filesize":100},
                    {"format_id":"higher","ext":"mp4","vcodec":"avc1","acodec":"none","height":height,"vbr":5000,"filesize":500}
                ])),
                Some(10.0),
            ),
        }
    }
    #[test]
    fn ceilings_match_each_entry_independently_and_estimate_exact_selected_tracks() {
        let policy = PlaylistQuality {
            max_height: Some(1080),
            max_video_bitrate_kbps: Some(3000),
            max_audio_bitrate_kbps: Some(160),
            allow_exceed: false,
        };
        let first = item(1, 2160);
        let result = select(&first, &policy, false);
        assert_eq!(result.format_id.as_deref(), Some("lower+a128"));
        assert_eq!(result.bytes, Some(110));
        assert!(!result.fallback_used);
        assert_eq!(result.merge_container, Some(MergeContainer::Mp4));
        let mut second = item(2, 720);
        second.formats.last_mut().unwrap().video_bitrate_kbps = Some(2000.0);
        assert_eq!(
            select(&second, &policy, false).format_id.as_deref(),
            Some("higher+a128")
        );
        let overrides = [QualityOverride {
            index: 1,
            policy: PlaylistQuality {
                max_height: Some(2160),
                ..Default::default()
            },
        }];
        assert_eq!(
            select(&first, effective(1, &policy, &overrides), false)
                .format_id
                .as_deref(),
            Some("higher+a256")
        );
        assert_eq!(
            select(&second, effective(2, &policy, &overrides), false)
                .format_id
                .as_deref(),
            Some("higher+a128")
        );
    }
    #[test]
    fn strict_limits_never_silently_exceed_unknown_is_not_a_match_and_fallback_is_explicit() {
        let item = item(1, 2160);
        let mut policy = PlaylistQuality {
            max_height: Some(240),
            ..Default::default()
        };
        assert!(select(&item, &policy, false).format_id.is_none());
        policy.allow_exceed = true;
        let result = select(&item, &policy, false);
        assert_eq!(result.format_id.as_deref(), Some("higher+a256"));
        assert!(result.fallback_used);
        let mut unknown = item.clone();
        for f in &mut unknown.formats {
            f.video_bitrate_kbps = None;
        }
        policy = PlaylistQuality {
            max_video_bitrate_kbps: Some(8000),
            ..Default::default()
        };
        assert!(select(&unknown, &policy, false).format_id.is_none());
        assert!(
            select(&unknown, &PlaylistQuality::default(), false)
                .format_id
                .is_some()
        );
    }
    #[test]
    fn muxed_stream_counts_once_mp3_stays_unknown_and_audio_only_ignores_video_caps() {
        let mut item = item(1, 1080);
        let policy = PlaylistQuality {
            max_height: Some(144),
            max_audio_bitrate_kbps: Some(128),
            ..Default::default()
        };
        let result = select(&item, &policy, true);
        assert_eq!(result.format_id.as_deref(), Some("a128"));
        assert!(result.bytes.is_none());
        item.formats = map_formats(
            Some(
                &json!([{"format_id":"combined","ext":"mp4","vcodec":"avc1","acodec":"aac","height":720,"vbr":1000,"abr":128,"filesize":1234}]),
            ),
            Some(10.0),
        );
        let result = select(&item, &PlaylistQuality::default(), false);
        assert_eq!(result.format_id.as_deref(), Some("combined"));
        assert_eq!(result.bytes, Some(1234));
        assert!(result.merge_container.is_none());
    }
    #[test]
    fn detail_projection_keeps_titles_and_original_positions_but_rejects_changed_or_nested_items() {
        let raw = json!({"entries":[{"playlist_index":3,"id":"three","title":"提前可见的标题","duration":8,"formats":[{"format_id":"v","ext":"mp4","vcodec":"avc1","height":720,"vbr":1000}]}, {"playlist_index":5,"id":"changed","title":"wrong"}]});
        let requested = [
            PlaylistSizeRequestItem {
                index: 3,
                id: Some("three".into()),
            },
            PlaylistSizeRequestItem {
                index: 5,
                id: Some("five".into()),
            },
            PlaylistSizeRequestItem { index: 7, id: None },
        ];
        let rows = map_details(&raw, &requested);
        assert_eq!(rows[0].title.as_deref(), Some("提前可见的标题"));
        assert_eq!(rows[0].index, 3);
        assert_eq!(rows[0].formats[0].height, Some(720));
        assert!(rows[1].error.is_some());
        assert!(rows[2].error.is_some());
        assert!(rows[1].title.is_none());
    }
    #[test]
    fn task_pins_exact_formats_original_position_id_policy_and_advanced_options() {
        let item = item(3, 2160);
        let mut policy = PlaylistQuality {
            max_height: Some(1080),
            max_video_bitrate_kbps: Some(3000),
            max_audio_bitrate_kbps: Some(128),
            allow_exceed: false,
        };
        let mut advanced = crate::domain::download_defaults::DownloadOptionDefaults {
            keep_intermediate_files: true,
            write_info_json: true,
            ..Default::default()
        };
        let options = task_options(
            "https://example.invalid/series",
            &item,
            &policy,
            &advanced,
            false,
        )
        .unwrap();
        policy.max_height = Some(2160);
        advanced.keep_intermediate_files = false;
        assert_eq!(options.format_id, "lower+a128");
        assert_eq!(options.playlist_items, Some(vec![3]));
        assert_eq!(options.expected_media_id.as_deref(), Some("video-3"));
        assert_eq!(options.quality_policy.unwrap().max_height, Some(1080));
        assert!(options.keep_intermediate_files);
        assert!(options.write_info_json);
        assert_eq!(options.use_proxy, Some(false));
        assert_eq!(policy.max_height, Some(2160));
        assert!(!advanced.keep_intermediate_files);
    }

    #[test]
    fn requests_and_overrides_are_bounded_validated_without_interpreting_user_commands() {
        let item = item(3, 1080);
        assert!(
            validate_request(
                std::slice::from_ref(&item),
                &PlaylistQuality::default(),
                &[]
            )
            .is_ok()
        );
        assert!(
            validate_request(
                &[item.clone(), item.clone()],
                &PlaylistQuality::default(),
                &[]
            )
            .is_err()
        );
        let mut bad = item.clone();
        bad.formats[0].format_id = "--exec".into();
        assert!(validate_request(&[bad], &PlaylistQuality::default(), &[]).is_err());
        assert!(
            validate_request(
                std::slice::from_ref(&item),
                &PlaylistQuality {
                    max_height: Some(0),
                    ..Default::default()
                },
                &[]
            )
            .is_err()
        );
        assert!(
            validate_request(
                &[item],
                &PlaylistQuality::default(),
                &[QualityOverride {
                    index: 2,
                    policy: PlaylistQuality::default()
                }]
            )
            .is_err()
        );
    }
}
