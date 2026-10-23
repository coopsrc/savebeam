//! Pure, deterministic per-entry matching. Both preview and task creation call this code.
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    media_mapper::{map_formats, map_subtitle_tracks},
    playlist_size::PlaylistSizeRequestItem,
};
use crate::domain::{
    download::MergeContainer,
    error::{AppError, ErrorCode},
    media::{FormatOption, SubtitleTrack},
    playlist_quality::PlaylistQuality,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaylistDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<crate::domain::media::MediaPreview>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<crate::domain::download::PlaylistPartContext>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub parts: Vec<PlaylistDetails>,
    pub index: u32,
    pub id: Option<String>,
    pub title: Option<String>,
    pub duration_seconds: Option<f64>,
    pub formats: Vec<FormatOption>,
    #[serde(default)]
    pub subtitles: Vec<SubtitleTrack>,
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
                preview: None,
                part: None,
                parts: Vec::new(),
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
                subtitles: if valid {
                    entry.map(map_subtitle_tracks).unwrap_or_default()
                } else {
                    Vec::new()
                },
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
fn extension_allowed(f: &FormatOption, requested: &Option<String>) -> bool {
    requested
        .as_deref()
        .is_none_or(|extension| f.extension.eq_ignore_ascii_case(extension))
}
fn codec_allowed(actual: Option<&str>, requested: Option<&str>) -> bool {
    let Some(requested) = requested else {
        return true;
    };
    let actual = actual.unwrap_or_default().to_ascii_lowercase();
    let prefixes: &[&str] = match requested {
        "h264" => &["avc", "h264", "h.264"],
        "hevc" => &["hev", "hvc", "hevc", "h265", "h.265"],
        "av1" => &["av01", "av1"],
        "vp9" => &["vp09", "vp9"],
        "vp8" => &["vp08", "vp8"],
        "aac" => &["mp4a", "aac"],
        "ac3" => &["ac3", "ac-3"],
        "eac3" => &["eac3", "eac-3", "ec-3"],
        "mpeg4" => &["mpeg4", "mp4v"],
        "opus" => &["opus"],
        "vorbis" => &["vorbis"],
        "mp3" => &["mp3"],
        "flac" => &["flac"],
        "alac" => &["alac"],
        "pcm" => &["pcm"],
        _ => return false,
    };
    prefixes.iter().any(|prefix| actual.starts_with(prefix))
}
fn audio_allowed(f: &FormatOption, p: &PlaylistQuality) -> bool {
    has_audio(f)
        && bounded(f.audio_bitrate_kbps, p.max_audio_bitrate_kbps)
        && extension_allowed(f, &p.audio_extension)
        && codec_allowed(f.audio_codec.as_deref(), p.audio_codec.as_deref())
}
fn video_allowed(f: &FormatOption, p: &PlaylistQuality) -> bool {
    let height = video_height(f);
    bounded(height, p.max_height)
        && bounded(f.video_bitrate_kbps, p.max_video_bitrate_kbps)
        && p.resolution_height
            .is_none_or(|requested| height == Some(f64::from(requested)))
        && p.frame_rate.is_none_or(|requested| {
            // Nominal 24/30/60 also accept broadcast rates 23.976/29.97/59.94.
            f.fps
                .is_some_and(|fps| fps.is_finite() && (fps - f64::from(requested)).abs() <= 0.1)
        })
        && extension_allowed(f, &p.video_extension)
        && codec_allowed(f.video_codec.as_deref(), p.video_codec.as_deref())
}
fn video_height(f: &FormatOption) -> Option<f64> {
    f.height.map(f64::from).or_else(|| {
        let resolution = f.resolution.as_deref()?;
        resolution
            .split('x')
            .next_back()?
            .trim_end_matches('p')
            .parse::<f64>()
            .ok()
    })
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
    if p.automatic_recommendations {
        return recommended_tracks(formats, p, audio_only);
    }
    let audio_ok = |f: &&FormatOption| audio_allowed(f, p);
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
        .find(|f| has_video(f) && has_audio(f) && video_allowed(f, p) && audio_allowed(f, p))
        .map(|v| (v, None))
}

fn recommended_audio<'a>(
    formats: &'a [FormatOption],
    p: &PlaylistQuality,
    video: Option<&FormatOption>,
    separate: bool,
) -> Option<&'a FormatOption> {
    formats
        .iter()
        .enumerate()
        .filter(|(_, f)| (!separate || !has_video(f)) && audio_allowed(f, p))
        .max_by_key(|(index, f)| {
            (
                p.audio_extension.is_none() && f.extension.eq_ignore_ascii_case("m4a"),
                p.audio_codec.is_none() && codec_allowed(f.audio_codec.as_deref(), Some("aac")),
                video.is_some_and(|v| container(v, f).extension() == v.extension),
                *index,
            )
        })
        .map(|(_, f)| f)
}

fn recommended_tracks<'a>(
    formats: &'a [FormatOption],
    p: &PlaylistQuality,
    audio_only: bool,
) -> Option<(&'a FormatOption, Option<&'a FormatOption>)> {
    if audio_only {
        return recommended_audio(formats, p, None, true)
            .or_else(|| recommended_audio(formats, p, None, false))
            .map(|a| (a, None));
    }
    formats
        .iter()
        .enumerate()
        .filter(|(_, v)| has_video(v) && video_allowed(v, p))
        .filter_map(|(index, v)| {
            let audio = if has_audio(v) {
                if !audio_allowed(v, p) {
                    return None;
                }
                None
            } else {
                Some(recommended_audio(formats, p, Some(v), true)?)
            };
            // Quality first. Format/codec preferences only break equal height/FPS ties.
            let key = (
                video_height(v).unwrap_or(0.0) as u32,
                v.fps.unwrap_or(0.0).round() as u32,
                p.video_extension.is_none() && v.extension.eq_ignore_ascii_case("mp4"),
                p.video_codec.is_none() && codec_allowed(v.video_codec.as_deref(), Some("hevc")),
                !has_audio(v),
                index,
            );
            Some((key, (v, audio)))
        })
        .max_by_key(|(key, _)| *key)
        .map(|(_, tracks)| tracks)
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
            .then(|| {
                tracks(
                    &item.formats,
                    &PlaylistQuality {
                        automatic_recommendations: policy.automatic_recommendations,
                        ..Default::default()
                    },
                    audio_only,
                )
            })
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
        result.error = Some(
            "没有符合所选分辨率、帧率、格式、编码或音频码率的组合；可单独调整或允许回退 Best。"
                .into(),
        );
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
    let keys: std::collections::BTreeSet<_> = items.iter().map(|i| i.index).collect();
    if items.is_empty() || items.len() > 50 || keys.len() != items.len() {
        return Err(invalid());
    }
    for item in items {
        if !item.parts.is_empty() {
            return Err(invalid());
        }
        if let Some(part) = &item.part {
            super::playlist_parts::validate(part)?;
            if item.index != part.parent_index * 1000 + part.part_index
                || item.id.as_deref() != Some(&format!("{}_p{}", part.parent_id, part.part_index))
            {
                return Err(invalid());
            }
        } else if !(1..=50).contains(&item.index) {
            return Err(invalid());
        }
    }
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
            || item.subtitles.len() > 512
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
        url: item.part.as_ref().map_or_else(
            || url.into(),
            |part| super::playlist_parts::parent_url(&part.parent_id),
        ),
        format_id: choice.format_id?,
        merge_container: choice.merge_container,
        playlist_item_count: Some(1),
        playlist_items: Some(vec![
            item.part.as_ref().map_or(item.index, |p| p.part_index),
        ]),
        playlist_part: item.part.clone(),
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
            preview: None,
            part: None,
            parts: Vec::new(),
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
            subtitles: Vec::new(),
        }
    }
    #[test]
    fn ceilings_match_each_entry_independently_and_estimate_exact_selected_tracks() {
        let policy = PlaylistQuality {
            max_height: Some(1080),
            max_video_bitrate_kbps: Some(3000),
            max_audio_bitrate_kbps: Some(160),
            allow_exceed: false,
            ..Default::default()
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
            ..Default::default()
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

    #[test]
    fn specified_resolution_fps_format_and_codec_match_together_not_as_ceilings() {
        let mut item = item(1, 1080);
        item.formats = map_formats(
            Some(&json!([
                {"format_id":"aac","ext":"m4a","acodec":"mp4a.40.2","abr":128,"vcodec":"none","filesize":10},
                {"format_id":"opus","ext":"webm","acodec":"opus","abr":160,"vcodec":"none","filesize":20},
                {"format_id":"avc30","ext":"mp4","vcodec":"avc1.640028","acodec":"none","height":1080,"fps":29.97,"filesize":100},
                {"format_id":"avc60","ext":"mp4","vcodec":"avc1.640028","acodec":"none","height":1080,"fps":59.94,"filesize":150},
                {"format_id":"hevc60","ext":"mp4","vcodec":"hvc1.1.6","acodec":"none","height":1080,"fps":60,"filesize":120},
                {"format_id":"vp9","ext":"webm","vcodec":"vp09.00","acodec":"none","height":2160,"fps":60,"filesize":500}
            ])),
            Some(10.0),
        );
        let mut policy = PlaylistQuality {
            resolution_height: Some(1080),
            frame_rate: Some(30),
            video_extension: Some("mp4".into()),
            video_codec: Some("h264".into()),
            audio_extension: Some("m4a".into()),
            audio_codec: Some("aac".into()),
            ..Default::default()
        };
        let selected = select(&item, &policy, false);
        assert_eq!(selected.format_id.as_deref(), Some("avc30+aac"));
        assert_eq!(selected.bytes, Some(110));
        assert_eq!(selected.merge_container, Some(MergeContainer::Mp4));
        policy.frame_rate = Some(60);
        assert_eq!(
            select(&item, &policy, false).format_id.as_deref(),
            Some("avc60+aac")
        );
        policy.video_codec = Some("hevc".into());
        assert_eq!(
            select(&item, &policy, false).format_id.as_deref(),
            Some("hevc60+aac")
        );
        policy.resolution_height = Some(720);
        assert!(select(&item, &policy, false).format_id.is_none());
        policy.allow_exceed = true;
        let fallback = select(&item, &policy, false);
        assert!(fallback.fallback_used);
        assert_eq!(fallback.format_id.as_deref(), Some("vp9+opus"));
        assert_eq!(fallback.merge_container, Some(MergeContainer::Webm));
        policy.allow_exceed = false;
        // In MP3-only mode video constraints do not filter the source audio.
        assert_eq!(
            select(&item, &policy, true).format_id.as_deref(),
            Some("aac")
        );
        assert!(select(&item, &policy, true).bytes.is_none());
        policy.audio_codec = Some("opus".into());
        assert!(select(&item, &policy, true).format_id.is_none());
        policy.audio_extension = Some("webm".into());
        assert_eq!(
            select(&item, &policy, true).format_id.as_deref(),
            Some("opus")
        );
    }

    #[test]
    fn missing_fps_or_wrong_container_never_silently_match_and_muxed_audio_is_filtered() {
        let mut item = item(1, 1080);
        let mut policy = PlaylistQuality {
            frame_rate: Some(30),
            ..Default::default()
        };
        assert!(select(&item, &policy, false).format_id.is_none());
        for f in &mut item.formats {
            f.fps = Some(30.5);
        }
        assert!(select(&item, &policy, false).format_id.is_none());
        for f in &mut item.formats {
            f.fps = Some(29.972);
        }
        assert!(select(&item, &policy, false).format_id.is_some());
        policy.video_extension = Some("webm".into());
        assert!(select(&item, &policy, false).format_id.is_none());
        item.formats = map_formats(
            Some(&json!([
                {"format_id":"mux","ext":"mp4","vcodec":"avc1","acodec":"aac","height":720,"fps":30,"filesize":123}
            ])),
            Some(10.0),
        );
        policy.video_extension = Some("mp4".into());
        policy.audio_codec = Some("opus".into());
        assert!(select(&item, &policy, false).format_id.is_none());
        policy.audio_codec = Some("aac".into());
        assert_eq!(select(&item, &policy, false).bytes, Some(123));
    }

    #[test]
    fn codec_families_and_legacy_snapshots_remain_compatible_but_invalid_filters_are_rejected() {
        for (family, actual) in [
            ("h264", "AVC1.640028"),
            ("hevc", "hev1.1.6"),
            ("av1", "av01.0.08M.08"),
            ("vp9", "vp09.00"),
            ("vp8", "vp08"),
            ("aac", "mp4a.40.2"),
            ("ac3", "ac-3"),
            ("eac3", "ec-3"),
            ("pcm", "pcm_s16le"),
        ] {
            assert!(codec_allowed(Some(actual), Some(family)));
            assert!(!codec_allowed(None, Some(family)));
        }
        let old: PlaylistQuality = serde_json::from_value(json!({
            "maxHeight":1080,"maxVideoBitrateKbps":3000,"maxAudioBitrateKbps":128,"allowExceed":false
        })).unwrap();
        assert!(old.validate().is_ok());
        assert_eq!(old.frame_rate, None);
        assert_eq!(
            select(&item(1, 2160), &old, false).format_id.as_deref(),
            Some("lower+a128")
        );
        for invalid in [
            json!({"frameRate":0}),
            json!({"frameRate":241}),
            json!({"resolutionHeight":0}),
            json!({"videoCodec":"--exec"}),
            json!({"audioCodec":"bogus"}),
            json!({"videoExtension":"../mp4"}),
            json!({"audioExtension":"--exec"}),
        ] {
            let policy: PlaylistQuality = serde_json::from_value(invalid).unwrap();
            assert!(policy.validate().is_err());
        }
        let policy = PlaylistQuality {
            resolution_height: Some(2160),
            frame_rate: None,
            video_extension: Some("mp4".into()),
            video_codec: Some("h264".into()),
            audio_extension: Some("m4a".into()),
            audio_codec: Some("aac".into()),
            ..Default::default()
        };
        let options = task_options(
            "https://example.invalid/list",
            &item(1, 2160),
            &policy,
            &Default::default(),
            false,
        )
        .unwrap();
        assert_eq!(options.quality_policy, Some(policy));
        assert_eq!(options.format_id, "higher+a256");
    }

    #[test]
    fn automatic_recommendations_are_soft_preferences_after_resolution_and_fps() {
        let mut item = item(1, 2160);
        item.formats = map_formats(
            Some(&json!([
                {"format_id":"aac","ext":"m4a","acodec":"mp4a.40.2","vcodec":"none","abr":128,"filesize":10},
                {"format_id":"opus","ext":"webm","acodec":"opus","vcodec":"none","abr":160,"filesize":20},
                {"format_id":"hevc-low","ext":"mp4","vcodec":"hvc1","acodec":"none","height":720,"fps":60,"filesize":50},
                {"format_id":"hevc30","ext":"mp4","vcodec":"hvc1","acodec":"none","height":2160,"fps":30,"filesize":90},
                {"format_id":"hevc60","ext":"mp4","vcodec":"hvc1","acodec":"none","height":2160,"fps":59.94,"filesize":100},
                {"format_id":"avc60","ext":"mp4","vcodec":"avc1","acodec":"none","height":2160,"fps":60,"filesize":150},
                {"format_id":"av1","ext":"webm","vcodec":"av01","acodec":"none","height":2160,"fps":60,"filesize":120}
            ])),
            Some(10.0),
        );
        let policy = PlaylistQuality {
            automatic_recommendations: true,
            ..Default::default()
        };
        let result = select(&item, &policy, false);
        assert_eq!(result.format_id.as_deref(), Some("hevc60+aac"));
        assert_eq!(result.bytes, Some(110));
        assert!(!result.fallback_used);
        // Old snapshots keep upstream ordering; new recommendation semantics are explicit.
        assert_eq!(
            select(&item, &Default::default(), false)
                .format_id
                .as_deref(),
            Some("av1+opus")
        );
        item.formats.retain(|f| f.format_id != "hevc60");
        assert_eq!(
            select(&item, &policy, false).format_id.as_deref(),
            Some("avc60+aac")
        );
        item.formats.retain(|f| !f.format_id.starts_with("hevc"));
        assert!(!select(&item, &policy, false).fallback_used);
        let explicit = PlaylistQuality {
            video_codec: Some("av1".into()),
            audio_codec: Some("opus".into()),
            ..policy.clone()
        };
        assert_eq!(
            select(&item, &explicit, false).format_id.as_deref(),
            Some("av1+opus")
        );
        let unavailable = PlaylistQuality {
            video_codec: Some("hevc".into()),
            ..policy.clone()
        };
        assert!(select(&item, &unavailable, false).format_id.is_none());
        let fallback = PlaylistQuality {
            allow_exceed: true,
            ..unavailable
        };
        let result = select(&item, &fallback, false);
        assert!(result.fallback_used);
        assert_eq!(result.format_id.as_deref(), Some("avc60+aac"));
        assert_eq!(
            select(&item, &policy, true).format_id.as_deref(),
            Some("aac")
        );
    }

    #[test]
    fn recommendation_does_not_choose_lower_quality_separate_video_over_better_muxed_video() {
        let mut item = item(1, 1080);
        item.formats.push(map_formats(Some(&json!([
            {"format_id":"mux4k","ext":"mp4","vcodec":"avc1","acodec":"aac","height":2160,"fps":60,"filesize":1000}
        ])), None).remove(0));
        let policy = PlaylistQuality {
            automatic_recommendations: true,
            ..Default::default()
        };
        assert_eq!(
            select(&item, &policy, false).format_id.as_deref(),
            Some("mux4k")
        );
        let options = task_options(
            "https://example.invalid/list",
            &item,
            &policy,
            &Default::default(),
            false,
        )
        .unwrap();
        assert!(options.quality_policy.unwrap().automatic_recommendations);
    }

    #[test]
    fn series_details_project_subtitle_languages_sources_and_formats_without_urls() {
        let raw = json!({"entries":[{
            "playlist_index":1, "id":"one", "title":"Title",
            "subtitles":{"en":[{"ext":"srt","name":"English","url":"https://private.invalid/sub","http_headers":{"Cookie":"secret"}}]},
            "automatic_captions":{"ja":[{"ext":"vtt","url":"https://private.invalid/auto"}]}
        }]});
        let details = map_details(
            &raw,
            &[PlaylistSizeRequestItem {
                index: 1,
                id: Some("one".into()),
            }],
        );
        assert_eq!(details[0].subtitles.len(), 2);
        assert!(!details[0].subtitles[0].automatic);
        assert!(details[0].subtitles[1].automatic);
        assert_eq!(details[0].subtitles[0].extension.as_deref(), Some("srt"));
        let serialized = serde_json::to_string(&details).unwrap();
        assert!(!serialized.contains("private.invalid"));
        assert!(!serialized.contains("Cookie"));
    }
}
