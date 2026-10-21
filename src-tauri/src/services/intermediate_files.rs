//! Best-effort naming of retained streams after native yt-dlp merging completes.
//! Never modify final outputs or overwrite existing files. Native temporary names
//! remain untouched during downloading/merging to preserve resume semantics.

use std::{fs, path::Path};

use crate::infrastructure::process_supervisor::{IntermediateFiles, IntermediateStream};

pub fn organize_retained_streams(groups: &[IntermediateFiles], outputs: &[String], root: &Path) {
    let Ok(root) = root.canonicalize() else {
        return;
    };
    for group in groups {
        let Ok(final_path) = Path::new(&group.output).canonicalize() else {
            continue;
        };
        if !final_path.starts_with(&root)
            || !outputs.iter().any(|output| Path::new(output) == final_path)
        {
            continue;
        }
        let Some(parent) = final_path.parent() else {
            continue;
        };
        let Some(title) = final_path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        for stream in &group.streams {
            let Some(source) = stream.filepath.as_deref().map(Path::new) else {
                continue;
            };
            // Refuse symlinks, paths outside this output's directory, or unrelated files.
            if !fs::symlink_metadata(source).is_ok_and(|metadata| metadata.file_type().is_file()) {
                continue;
            }
            let Ok(source) = source.canonicalize() else {
                continue;
            };
            let (Some(id), Some(ext)) = (&stream.format_id, &stream.ext) else {
                continue;
            };
            if source == final_path
                || source.parent() != Some(parent)
                || source.file_name().and_then(|value| value.to_str())
                    != Some(format!("{title}.f{id}.{ext}").as_str())
            {
                continue;
            }
            let Some(name) = retained_name(title, stream) else {
                continue;
            };
            let target = parent.join(name);
            // Same-directory hard link + unlink is no-clobber on supported filesystems.
            // If unsupported, or a name already exists, leave the native source intact.
            if fs::hard_link(&source, &target).is_ok() {
                let _ = fs::remove_file(&source);
            }
        }
    }
}

fn retained_name(title: &str, stream: &IntermediateStream) -> Option<String> {
    let id = token(stream.format_id.as_deref()?, 32)?;
    let ext = token(stream.ext.as_deref()?, 10)?;
    let video = stream.vcodec.as_deref().filter(|value| *value != "none");
    let audio = stream.acodec.as_deref().filter(|value| *value != "none");
    let (kind, codec, resolution, bitrate) = if let Some(codec) = video {
        let resolution = match (stream.width, stream.height) {
            (Some(width), Some(height))
                if (1..100_000).contains(&width) && (1..100_000).contains(&height) =>
            {
                format!("{width}x{height}")
            }
            _ => stream
                .resolution
                .as_deref()
                .and_then(|value| token(value, 20))
                .unwrap_or_else(|| "resolution-unknown".into()),
        };
        (
            "video",
            codec,
            resolution,
            stream.vbr.filter(|value| *value > 0.0).or(stream.tbr),
        )
    } else {
        let codec = audio?;
        (
            "audio",
            codec,
            "audio-only".into(),
            stream.abr.filter(|value| *value > 0.0).or(stream.tbr),
        )
    };
    let codec = token(codec, 28).unwrap_or_else(|| "codec-unknown".into());
    let bitrate = bitrate
        .filter(|value| value.is_finite() && *value > 0.0 && *value < 1e9)
        .map(|value| format!("{value:.0}kbps"))
        .unwrap_or_else(|| "bitrate-unknown".into());
    // Leave room for technical fields under common 255-byte filename limits.
    let mut end = title.len().min(120);
    while !title.is_char_boundary(end) {
        end -= 1;
    }
    Some(format!(
        "{}.{kind}.f{id}.{codec}.{resolution}.{bitrate}.{ext}",
        &title[..end]
    ))
}

fn token(value: &str, max: usize) -> Option<String> {
    let value: String = value
        .chars()
        .take(max)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect();
    (!value.is_empty() && value != "." && value != "..").then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video() -> IntermediateStream {
        IntermediateStream {
            format_id: Some("30120".into()),
            ext: Some("mp4".into()),
            vcodec: Some("avc1.640033".into()),
            width: Some(3840),
            height: Some(2160),
            vbr: Some(5500.4),
            ..Default::default()
        }
    }

    #[test]
    fn uses_each_streams_actual_id_codec_resolution_and_bitrate() {
        assert_eq!(
            retained_name("标题", &video()).unwrap(),
            "标题.video.f30120.avc1.640033.3840x2160.5500kbps.mp4"
        );
        let audio = IntermediateStream {
            format_id: Some("30280".into()),
            ext: Some("m4a".into()),
            vcodec: Some("none".into()),
            acodec: Some("mp4a.40.2".into()),
            abr: Some(152.1),
            ..Default::default()
        };
        assert_eq!(
            retained_name("标题", &audio).unwrap(),
            "标题.audio.f30280.mp4a.40.2.audio-only.152kbps.m4a"
        );
    }

    #[test]
    fn unknown_bitrate_is_not_fabricated_and_long_unicode_titles_are_bounded() {
        let mut stream = video();
        stream.vbr = None;
        let name = retained_name(&"标题".repeat(100), &stream).unwrap();
        assert!(name.contains("bitrate-unknown"));
        assert!(name.len() <= 255);
        stream.format_id = Some("../../bad:id".into());
        assert!(!retained_name("title", &stream).unwrap().contains('/'));
    }

    #[test]
    fn organizes_series_streams_without_modifying_final_files_or_clobbering_collisions() {
        let root = std::env::temp_dir().join(format!(
            "savebeam-retained-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let series = root.join("系列");
        fs::create_dir_all(&series).unwrap();
        let final_path = series.join("1-标题.mp4");
        fs::write(&final_path, b"merged").unwrap();
        let source = series.join("1-标题.f30120.mp4");
        fs::write(&source, b"video").unwrap();
        let mut stream = video();
        stream.filepath = Some(source.to_string_lossy().into_owned());
        let target = series.join(retained_name("1-标题", &stream).unwrap());
        fs::write(&target, b"existing").unwrap();
        let groups = [IntermediateFiles {
            output: final_path.to_string_lossy().into_owned(),
            streams: vec![stream],
        }];
        let outputs = [final_path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned()];
        organize_retained_streams(&groups, &outputs, &root);
        assert_eq!(fs::read(&target).unwrap(), b"existing");
        assert!(source.exists());
        fs::remove_file(&target).unwrap();
        organize_retained_streams(&groups, &outputs, &root);
        assert_eq!(fs::read(&target).unwrap(), b"video");
        assert!(!source.exists());
        assert_eq!(fs::read(&final_path).unwrap(), b"merged");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_unverified_outputs_unrelated_files_and_symlinks() {
        let root = std::env::temp_dir().join(format!(
            "savebeam-retained-security-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let download = root.join("download");
        fs::create_dir_all(&download).unwrap();
        let final_path = download.join("title.mp4");
        fs::write(&final_path, b"merged").unwrap();
        let outside = root.join("title.f30120.mp4");
        fs::write(&outside, b"outside").unwrap();
        let link = download.join("title.f30120.mp4");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        let unrelated = download.join("notes.txt");
        fs::write(&unrelated, b"notes").unwrap();
        let outputs = [final_path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned()];
        for source in [&final_path, &outside, &link, &unrelated] {
            let mut stream = video();
            stream.filepath = Some(source.to_string_lossy().into_owned());
            let groups = [IntermediateFiles {
                output: final_path.to_string_lossy().into_owned(),
                streams: vec![stream],
            }];
            organize_retained_streams(&groups, &outputs, &download);
            assert!(source.exists());
        }
        fs::remove_file(&link).unwrap();
        fs::write(&link, b"source").unwrap();
        let mut stream = video();
        stream.filepath = Some(link.to_string_lossy().into_owned());
        let groups = [IntermediateFiles {
            output: final_path.to_string_lossy().into_owned(),
            streams: vec![stream],
        }];
        organize_retained_streams(&groups, &[], &download);
        assert!(link.exists());
        assert_eq!(fs::read(&final_path).unwrap(), b"merged");
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
        assert_eq!(fs::read(&unrelated).unwrap(), b"notes");
        fs::remove_dir_all(root).unwrap();
    }
}
