//! Trusted component release catalog hosted as a GitHub Release asset.

use std::io::Read;

use crate::domain::{
    component_manifest::ComponentManifest,
    error::{AppError, ErrorCode},
};

pub const COMPONENT_MANIFEST_URL: &str =
    "https://github.com/coopsrc/savebeam/releases/latest/download/components.json";
pub const COMPONENT_MANIFEST_PUBLIC_KEY: [u8; 32] = [
    0x53, 0x80, 0x51, 0x5f, 0xbf, 0x3a, 0x3b, 0x23, 0x16, 0x80, 0xf3, 0x69, 0xbf, 0x15, 0x0e, 0x69,
    0xf6, 0x9d, 0xc5, 0x16, 0xa3, 0x5f, 0x2d, 0xbe, 0xb1, 0xfe, 0xa2, 0xc0, 0x64, 0x71, 0x1e, 0xb7,
];

const MAX_MANIFEST_BYTES: u64 = 256 * 1024;

pub fn fetch_verified_manifest() -> Result<ComponentManifest, AppError> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                attempt.stop()
            } else if attempt.url().scheme() == "https"
                && attempt.url().host_str().is_some_and(is_github_asset_host)
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|error| catalog_error("无法初始化组件发行目录连接。", error.to_string()))?;
    let response = client
        .get(COMPONENT_MANIFEST_URL)
        .send()
        .and_then(reqwest::blocking::Response::error_for_status)
        .map_err(|error| {
            catalog_error(
                "暂时无法读取组件发行目录；请稍后重试或使用手动安装方式。",
                error.to_string(),
            )
        })?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MANIFEST_BYTES)
    {
        return Err(catalog_error(
            "组件发行目录文件过大。",
            "size limit exceeded".into(),
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| catalog_error("无法读取组件发行目录。", error.to_string()))?;
    if bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err(catalog_error(
            "组件发行目录文件过大。",
            "size limit exceeded".into(),
        ));
    }
    let manifest: ComponentManifest = serde_json::from_slice(&bytes)
        .map_err(|error| catalog_error("组件发行目录格式无效。", error.to_string()))?;
    manifest.verify(&COMPONENT_MANIFEST_PUBLIC_KEY)?;
    Ok(manifest)
}

fn catalog_error(message: &str, diagnostic: String) -> AppError {
    AppError::new(ErrorCode::NetworkFailure, message, true).with_diagnostic(diagnostic)
}

fn is_github_asset_host(host: &str) -> bool {
    host == "github.com"
        || host == "objects.githubusercontent.com"
        || host == "release-assets.githubusercontent.com"
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::VerifyingKey;

    use super::{COMPONENT_MANIFEST_PUBLIC_KEY, COMPONENT_MANIFEST_URL, is_github_asset_host};

    #[test]
    fn embeds_a_valid_trust_key_and_fixed_savebeam_release_asset_url() {
        assert!(VerifyingKey::from_bytes(&COMPONENT_MANIFEST_PUBLIC_KEY).is_ok());
        assert_eq!(
            COMPONENT_MANIFEST_URL,
            "https://github.com/coopsrc/savebeam/releases/latest/download/components.json"
        );
    }

    #[test]
    fn release_asset_redirects_are_limited_to_github_hosts() {
        assert!(is_github_asset_host("github.com"));
        assert!(is_github_asset_host("release-assets.githubusercontent.com"));
        assert!(!is_github_asset_host("github.com.attacker.invalid"));
        assert!(!is_github_asset_host("attacker.invalid"));
    }
}
