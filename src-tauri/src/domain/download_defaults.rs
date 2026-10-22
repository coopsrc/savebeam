//! Default advanced options are copied into task options once, never consulted at execution.
use serde::{Deserialize, Serialize};

use super::download::DownloadOptions;

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DownloadOptionDefaults {
    pub audio_only: bool,
    pub subtitle_languages: Vec<String>,
    pub write_automatic_subtitles: bool,
    pub write_thumbnail: bool,
    pub write_info_json: bool,
    pub embed_metadata: bool,
    pub keep_intermediate_files: bool,
}

impl DownloadOptionDefaults {
    pub fn apply_to(&self, options: &mut DownloadOptions) {
        options.audio_only = self.audio_only;
        options.subtitle_languages = self.subtitle_languages.clone();
        options.write_automatic_subtitles = self.write_automatic_subtitles;
        options.write_thumbnail = self.write_thumbnail;
        options.write_info_json = self.write_info_json;
        options.embed_metadata = self.embed_metadata;
        options.keep_intermediate_files = self.keep_intermediate_files;
    }
}

impl From<&DownloadOptions> for DownloadOptionDefaults {
    fn from(options: &DownloadOptions) -> Self {
        Self {
            audio_only: options.audio_only,
            subtitle_languages: options.subtitle_languages.clone(),
            write_automatic_subtitles: options.write_automatic_subtitles,
            write_thumbnail: options.write_thumbnail,
            write_info_json: options.write_info_json,
            embed_metadata: options.embed_metadata,
            keep_intermediate_files: options.keep_intermediate_files,
        }
    }
}
