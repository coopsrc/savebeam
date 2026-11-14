//! Bounded version and basic capability checks for discovered executables.

use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use crate::{
    domain::component::{ComponentInstallation, ComponentKind, ComponentStatus},
    infrastructure::process_supervisor::{configure_process_group, terminate_child},
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
// Signed standalone yt-dlp has a cold-start unpack/security check on macOS.
const YTDLP_PROBE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CAPTURE_BYTES: usize = 16 * 1024;

pub fn probe_installation(installation: &ComponentInstallation) -> ComponentInstallation {
    if installation.status == ComponentStatus::Missing {
        return installation.clone();
    }
    let Some(executable_path) = installation.executable_path.as_deref() else {
        return installation.clone();
    };

    let Some(argument) = version_command(installation.kind, Path::new(executable_path)) else {
        return unhealthy(installation);
    };

    let timeout = if installation.kind == ComponentKind::YtDlp {
        YTDLP_PROBE_TIMEOUT
    } else {
        PROBE_TIMEOUT
    };
    match run_bounded_version_command(Path::new(executable_path), argument, timeout) {
        Ok(output) => match extract_version(&output) {
            Some(version) => ComponentInstallation {
                status: compatibility_status(
                    installation.kind,
                    Path::new(executable_path),
                    &version,
                    &output,
                ),
                version: Some(version),
                ..installation.clone()
            },
            None => unhealthy(installation),
        },
        Err(_) => unhealthy(installation),
    }
}

pub fn probe_all(
    installations: impl IntoIterator<Item = ComponentInstallation>,
) -> Vec<ComponentInstallation> {
    installations
        .into_iter()
        .map(|installation| probe_installation(&installation))
        .collect()
}

fn unhealthy(installation: &ComponentInstallation) -> ComponentInstallation {
    ComponentInstallation {
        status: ComponentStatus::Unhealthy,
        version: None,
        ..installation.clone()
    }
}

fn version_command(kind: ComponentKind, path: &Path) -> Option<&'static str> {
    let executable = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    let executable = executable.strip_suffix(".exe").unwrap_or(&executable);

    match (kind, executable) {
        (ComponentKind::YtDlp, "yt-dlp") => Some("--version"),
        (ComponentKind::Ffmpeg, "ffmpeg") => Some("-version"),
        (ComponentKind::Ffprobe, "ffprobe") => Some("-version"),
        (ComponentKind::JavaScriptRuntime, "deno") => Some("--version"),
        (ComponentKind::JavaScriptRuntime, "node") => Some("--version"),
        (ComponentKind::JavaScriptRuntime, "bun") => Some("--version"),
        (ComponentKind::JavaScriptRuntime, "qjs") => Some("-v"),
        _ => None,
    }
}

fn run_bounded_version_command(
    executable: &Path,
    argument: &str,
    timeout: Duration,
) -> std::io::Result<String> {
    let mut command = Command::new(executable);
    command
        .arg(argument)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn()?;

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let stdout_reader = thread::spawn(move || read_bounded(stdout));
    let stderr_reader = thread::spawn(move || read_bounded(stderr));

    let started_at = Instant::now();
    let exit_status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started_at.elapsed() >= timeout {
            terminate_child(&mut child);
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "component version probe timed out",
            ));
        }
        thread::sleep(Duration::from_millis(25));
    };

    let mut output = stdout_reader
        .join()
        .map_err(|_| std::io::Error::other("stdout reader failed"))?;
    let stderr_output = stderr_reader
        .join()
        .map_err(|_| std::io::Error::other("stderr reader failed"))?;
    output.extend(stderr_output);

    if !exit_status.success() {
        return Err(std::io::Error::other("component version command failed"));
    }

    Ok(String::from_utf8_lossy(&output).into_owned())
}

fn read_bounded(mut reader: impl Read) -> Vec<u8> {
    let mut retained = Vec::new();
    let mut chunk = [0_u8; 1024];

    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let remaining = MAX_CAPTURE_BYTES.saturating_sub(retained.len());
                retained.extend_from_slice(&chunk[..read.min(remaining)]);
            }
        }
    }
    retained
}

fn extract_version(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.split_whitespace().find_map(|token| {
            let token = token.trim_matches(|character: char| {
                !(character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+' | '_'))
            });
            (token.chars().any(|character| character.is_ascii_digit())
                && token.chars().any(|character| {
                    character.is_ascii_alphabetic() || matches!(character, '.' | '-' | '+' | '_')
                }))
            .then(|| token.to_owned())
        })
    })
}

fn compatibility_status(
    kind: ComponentKind,
    executable: &Path,
    version: &str,
    output: &str,
) -> ComponentStatus {
    if kind != ComponentKind::JavaScriptRuntime {
        return ComponentStatus::Available;
    }

    let filename = executable
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let flavor = filename.strip_suffix(".exe").unwrap_or(&filename);

    match flavor {
        "deno" => is_at_least(version, &[2, 3, 0]),
        "node" => is_at_least(version, &[22, 0, 0]),
        "bun" => {
            if is_at_least(version, &[1, 2, 11]) == ComponentStatus::Available
                && !is_greater_than(version, &[1, 3, 14])
            {
                ComponentStatus::Available
            } else {
                ComponentStatus::Outdated
            }
        }
        "qjs" if output.to_ascii_lowercase().contains("quickjs-ng") => ComponentStatus::Available,
        "qjs" => is_at_least(version, &[2023, 12, 9]),
        _ => ComponentStatus::Unhealthy,
    }
}

fn is_at_least(version: &str, minimum: &[u32; 3]) -> ComponentStatus {
    match parse_version_components(version) {
        Some(components) if components >= *minimum => ComponentStatus::Available,
        Some(_) => ComponentStatus::Outdated,
        None => ComponentStatus::Unhealthy,
    }
}

fn is_greater_than(version: &str, maximum: &[u32; 3]) -> bool {
    parse_version_components(version).is_some_and(|components| components > *maximum)
}

fn parse_version_components(version: &str) -> Option<[u32; 3]> {
    let mut components = version.trim_start_matches(['v', 'V']).split(['.', '-']);
    Some([
        components.next()?.parse().ok()?,
        components.next()?.parse().ok()?,
        components.next()?.parse().ok()?,
    ])
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn timeout_terminates_descendants_holding_probe_pipes() {
        let root = std::env::temp_dir().join(format!("savebeam-probe-tree-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("probe.sh");
        std::fs::write(&script, "sleep 60 &\nwait\n").unwrap();
        let start = std::time::Instant::now();
        let error = super::run_bounded_version_command(
            std::path::Path::new("/bin/sh"),
            script.to_str().unwrap(),
            std::time::Duration::from_millis(100),
        )
        .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[cfg(unix)]
    use super::{ComponentInstallation, probe_installation};
    use super::{MAX_CAPTURE_BYTES, extract_version, read_bounded};
    #[cfg(unix)]
    use crate::domain::component::{ComponentKind, ComponentSource, ComponentStatus};

    #[cfg(unix)]
    fn test_executable_name(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "savebeam-probe-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test directory should exist");
        root.join(name)
    }

    #[test]
    fn extracts_common_version_formats_from_component_output() {
        assert_eq!(
            extract_version("2026.10.21\n"),
            Some("2026.10.21".to_owned())
        );
        assert_eq!(
            extract_version("ffmpeg version n8.1.2 Copyright (c)"),
            Some("n8.1.2".to_owned())
        );
        assert_eq!(
            extract_version("QuickJS version 2025-09-13\n"),
            Some("2025-09-13".to_owned())
        );
        assert_eq!(extract_version("version unavailable"), None);
    }

    #[test]
    fn enforces_yt_dlp_javascript_runtime_compatibility_floors() {
        use std::path::Path;

        use crate::domain::component::{ComponentKind, ComponentStatus};

        assert_eq!(
            super::compatibility_status(
                ComponentKind::JavaScriptRuntime,
                Path::new("deno"),
                "2.2.0",
                "deno 2.2.0",
            ),
            ComponentStatus::Outdated
        );
        assert_eq!(
            super::compatibility_status(
                ComponentKind::JavaScriptRuntime,
                Path::new("deno"),
                "2.3.0",
                "deno 2.3.0",
            ),
            ComponentStatus::Available
        );
        assert_eq!(
            super::compatibility_status(
                ComponentKind::JavaScriptRuntime,
                Path::new("node"),
                "v20.19.2",
                "v20.19.2",
            ),
            ComponentStatus::Outdated
        );
        assert_eq!(
            super::compatibility_status(
                ComponentKind::JavaScriptRuntime,
                Path::new("bun"),
                "1.3.15",
                "1.3.15",
            ),
            ComponentStatus::Outdated
        );
        assert_eq!(
            super::compatibility_status(
                ComponentKind::JavaScriptRuntime,
                Path::new("qjs"),
                "2025-04-26",
                "QuickJS version 2025-04-26",
            ),
            ComponentStatus::Available
        );
        assert_eq!(
            super::compatibility_status(
                ComponentKind::JavaScriptRuntime,
                Path::new("qjs"),
                "0.11.0",
                "QuickJS-NG 0.11.0",
            ),
            ComponentStatus::Available
        );
    }

    #[test]
    fn version_output_capture_is_bounded() {
        let output = vec![b'x'; MAX_CAPTURE_BYTES * 3];
        let captured = read_bounded(output.as_slice());

        assert_eq!(captured.len(), MAX_CAPTURE_BYTES);
    }

    #[cfg(unix)]
    fn write_fake_executable(path: &PathBuf, body: &str) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, format!("#!/bin/sh\n{body}\n")).expect("test command should be written");
        fs::set_permissions(path, fs::Permissions::from_mode(0o755))
            .expect("test command should be executable");
    }

    #[cfg(unix)]
    #[test]
    fn probes_version_with_the_component_specific_fixed_argument() {
        let path = test_executable_name("yt-dlp");
        write_fake_executable(
            &path,
            "[ \"$1\" = \"--version\" ] || exit 21\nprintf '2026.10.21\\n'",
        );
        let installation = ComponentInstallation {
            kind: ComponentKind::YtDlp,
            source: Some(ComponentSource::Custom),
            status: ComponentStatus::Available,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
        };

        let probed = probe_installation(&installation);

        assert_eq!(probed.status, ComponentStatus::Available);
        assert_eq!(probed.version.as_deref(), Some("2026.10.21"));
        let _ = fs::remove_dir_all(path.parent().expect("test executable has parent"));
    }

    #[cfg(unix)]
    #[test]
    fn marks_a_failed_version_command_unhealthy() {
        let path = test_executable_name("node");
        write_fake_executable(&path, "exit 7");
        let installation = ComponentInstallation {
            kind: ComponentKind::JavaScriptRuntime,
            source: Some(ComponentSource::System),
            status: ComponentStatus::Available,
            executable_path: Some(path.to_string_lossy().into_owned()),
            version: None,
        };

        let probed = probe_installation(&installation);

        assert_eq!(probed.status, ComponentStatus::Unhealthy);
        assert_eq!(probed.executable_path, installation.executable_path);
        let _ = fs::remove_dir_all(path.parent().expect("test executable has parent"));
    }

    #[cfg(unix)]
    #[test]
    fn app_managed_component_matrix_accepts_yt_dlp_ffmpeg_ffprobe_and_supported_deno() {
        use std::os::unix::fs::PermissionsExt;

        use crate::{
            domain::component::ComponentKind,
            services::{component_detector::ComponentDetector, component_paths::ComponentPaths},
        };

        let root = std::env::temp_dir().join(format!(
            "savebeam-component-matrix-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let paths = ComponentPaths::from_app_data_dir(&root);
        for (kind, name, output) in [
            (ComponentKind::YtDlp, "yt-dlp", "2026.10.1"),
            (ComponentKind::Ffmpeg, "ffmpeg", "ffmpeg version n8.0"),
            (ComponentKind::Ffprobe, "ffprobe", "ffprobe version n8.0"),
            (ComponentKind::JavaScriptRuntime, "deno", "deno 2.3.0"),
        ] {
            let directory = paths.ensure_component_dir(kind).unwrap();
            let executable = directory.join(name);
            std::fs::write(&executable, format!("#!/bin/sh\necho '{output}'\n")).unwrap();
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let detector = ComponentDetector::with_search_paths(paths, vec![], vec![]);
        let installations =
            super::probe_all(detector.detect_all(&std::collections::HashMap::new()));
        assert!(
            installations
                .iter()
                .all(|item| item.status == ComponentStatus::Available)
        );
        assert!(
            installations
                .iter()
                .all(|item| item.source
                    == Some(crate::domain::component::ComponentSource::AppManaged))
        );
        assert_eq!(
            installations
                .iter()
                .find(|item| item.kind == ComponentKind::JavaScriptRuntime)
                .unwrap()
                .version
                .as_deref(),
            Some("2.3.0")
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
