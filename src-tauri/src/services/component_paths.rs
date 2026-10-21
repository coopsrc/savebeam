//! Cross-platform app-managed component directory layout.

use std::path::{Path, PathBuf};

use crate::domain::component::ComponentKind;

#[derive(Debug, Clone)]
pub struct ComponentPaths {
    app_data_dir: PathBuf,
}

impl ComponentPaths {
    /// Uses Tauri's platform-specific application data directory as the root.
    pub fn from_app_data_dir(app_data_dir: impl Into<PathBuf>) -> Self {
        Self {
            app_data_dir: app_data_dir.into(),
        }
    }

    pub fn root(&self) -> PathBuf {
        self.app_data_dir.join("components")
    }

    pub fn component_dir(&self, kind: ComponentKind) -> PathBuf {
        self.root().join(component_slug(kind))
    }

    pub fn managed_executable_paths(&self, kind: ComponentKind) -> Vec<PathBuf> {
        let directory = self.component_dir(kind);
        kind.executable_names()
            .iter()
            .map(|name| directory.join(name))
            .collect()
    }

    pub fn ensure_component_dir(&self, kind: ComponentKind) -> std::io::Result<PathBuf> {
        let path = self.component_dir(kind);
        std::fs::create_dir_all(&path)?;
        Ok(path)
    }

    pub fn is_managed_path(&self, kind: ComponentKind, candidate: &Path) -> bool {
        candidate.starts_with(self.component_dir(kind))
    }
}

const fn component_slug(kind: ComponentKind) -> &'static str {
    match kind {
        ComponentKind::YtDlp => "yt-dlp",
        ComponentKind::Ffmpeg => "ffmpeg",
        ComponentKind::Ffprobe => "ffprobe",
        ComponentKind::JavaScriptRuntime => "javascript-runtime",
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::ComponentPaths;
    use crate::domain::component::ComponentKind;

    #[test]
    fn managed_directories_are_scoped_under_the_platform_app_data_directory() {
        let base = std::env::temp_dir().join(format!(
            "savebeam-path-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ));
        let paths = ComponentPaths::from_app_data_dir(&base);

        assert_eq!(paths.root(), base.join("components"));
        assert_eq!(
            paths.component_dir(ComponentKind::YtDlp),
            base.join("components/yt-dlp")
        );
        assert_eq!(
            paths.component_dir(ComponentKind::JavaScriptRuntime),
            base.join("components/javascript-runtime")
        );
        assert!(
            paths
                .managed_executable_paths(ComponentKind::Ffmpeg)
                .iter()
                .all(|path| paths.is_managed_path(ComponentKind::Ffmpeg, path))
        );

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn ensuring_a_component_directory_creates_only_its_scoped_directory() {
        let base = std::env::temp_dir().join(format!(
            "savebeam-component-dir-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ));
        let paths = ComponentPaths::from_app_data_dir(&base);
        let created = paths
            .ensure_component_dir(ComponentKind::Ffprobe)
            .expect("component directory should be created");

        assert_eq!(created, base.join("components/ffprobe"));
        assert!(created.is_dir());
        let _ = std::fs::remove_dir_all(base);
    }
}
