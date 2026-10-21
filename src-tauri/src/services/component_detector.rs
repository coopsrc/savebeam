//! Deterministic component discovery without executing candidate binaries.

use std::{
    collections::HashMap,
    env,
    path::{Path, PathBuf},
};

use crate::domain::component::{
    ComponentInstallation, ComponentKind, ComponentSource, ComponentStatus,
};

use super::component_paths::ComponentPaths;

#[derive(Debug, Clone)]
pub struct ComponentDetector {
    managed_paths: ComponentPaths,
    common_system_dirs: Vec<PathBuf>,
    path_dirs: Vec<PathBuf>,
}

impl ComponentDetector {
    pub fn from_environment(managed_paths: ComponentPaths) -> Self {
        Self {
            managed_paths,
            common_system_dirs: common_system_dirs(),
            path_dirs: env::var_os("PATH")
                .map(|value| env::split_paths(&value).collect())
                .unwrap_or_default(),
        }
    }

    pub fn with_search_paths(
        managed_paths: ComponentPaths,
        common_system_dirs: Vec<PathBuf>,
        path_dirs: Vec<PathBuf>,
    ) -> Self {
        Self {
            managed_paths,
            common_system_dirs,
            path_dirs,
        }
    }

    pub fn detect(&self, kind: ComponentKind, custom_path: Option<&Path>) -> ComponentInstallation {
        if let Some(path) = custom_path.filter(|path| is_usable_file(path)) {
            return installation(kind, ComponentSource::Custom, path);
        }

        for path in self.managed_paths.managed_executable_paths(kind) {
            if is_usable_file(&path) {
                return installation(kind, ComponentSource::AppManaged, &path);
            }
        }

        for directory in self.common_system_dirs.iter().chain(self.path_dirs.iter()) {
            for executable in kind.executable_names() {
                let candidate = directory.join(executable);
                if is_usable_file(&candidate) {
                    return installation(kind, ComponentSource::System, &candidate);
                }
            }
        }

        ComponentInstallation::missing(kind)
    }

    pub fn detect_all(
        &self,
        custom_paths: &HashMap<ComponentKind, PathBuf>,
    ) -> Vec<ComponentInstallation> {
        ComponentKind::ALL
            .into_iter()
            .map(|kind| self.detect(kind, custom_paths.get(&kind).map(PathBuf::as_path)))
            .collect()
    }
}

fn installation(
    kind: ComponentKind,
    source: ComponentSource,
    path: &Path,
) -> ComponentInstallation {
    ComponentInstallation {
        kind,
        source: Some(source),
        status: ComponentStatus::Available,
        executable_path: Some(path.to_string_lossy().into_owned()),
        version: None,
    }
}

pub fn is_usable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn common_system_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "macos")]
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/local/bin"),
        PathBuf::from("/usr/bin"),
    ]);

    #[cfg(target_os = "linux")]
    dirs.extend([
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/snap/bin"),
    ]);

    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("yt-dlp"));
        }
        if let Some(program_data) = env::var_os("ProgramData") {
            dirs.push(PathBuf::from(program_data).join("chocolatey/bin"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local = PathBuf::from(local_app_data);
            dirs.push(local.join("Microsoft/WinGet/Links"));
            dirs.push(local.join("Programs/Scoop/shims"));
        }
    }

    dirs
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::ComponentDetector;
    use crate::{
        domain::component::{ComponentKind, ComponentSource},
        services::component_paths::ComponentPaths,
    };

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "savebeam-detection-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ))
    }

    fn create_executable(path: &std::path::Path) {
        fs::create_dir_all(path.parent().expect("test file should have a parent"))
            .expect("test directory should be created");
        fs::write(path, "test executable").expect("test file should be created");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755))
                .expect("test executable should be marked executable");
        }
    }

    #[test]
    fn custom_path_precedes_app_managed_path() {
        let root = test_root();
        let managed = ComponentPaths::from_app_data_dir(root.join("app-data"));
        let managed_binary = managed.managed_executable_paths(ComponentKind::YtDlp)[0].clone();
        let custom_binary = root.join("custom/yt-dlp");
        create_executable(&managed_binary);
        create_executable(&custom_binary);
        let detector = ComponentDetector::with_search_paths(managed, Vec::new(), Vec::new());

        let detected = detector.detect(ComponentKind::YtDlp, Some(&custom_binary));

        assert_eq!(detected.source, Some(ComponentSource::Custom));
        assert_eq!(
            detected.executable_path,
            Some(custom_binary.to_string_lossy().into_owned())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_managed_path_precedes_system_paths() {
        let root = test_root();
        let managed = ComponentPaths::from_app_data_dir(root.join("app-data"));
        let managed_binary = managed.managed_executable_paths(ComponentKind::Ffmpeg)[0].clone();
        let system_dir = root.join("system/bin");
        let system_binary = system_dir.join("ffmpeg");
        create_executable(&managed_binary);
        create_executable(&system_binary);
        let detector = ComponentDetector::with_search_paths(managed, vec![system_dir], Vec::new());

        let detected = detector.detect(ComponentKind::Ffmpeg, None);

        assert_eq!(detected.source, Some(ComponentSource::AppManaged));
        let _ = fs::remove_dir_all(root);
    }
}
