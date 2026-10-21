//! Versioned component release manifests with a detached Ed25519 signature.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use super::{
    component::ComponentKind,
    error::{AppError, ErrorCode},
};

pub const COMPONENT_MANIFEST_SCHEMA: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentManifest {
    pub schema_version: u32,
    pub manifest_version: String,
    pub generated_at_unix_ms: u64,
    pub entries: Vec<ComponentRelease>,
    /// Hex-encoded Ed25519 signature over the JSON serialization of `SignedManifest`.
    pub signature: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedManifest {
    pub schema_version: u32,
    pub manifest_version: String,
    pub generated_at_unix_ms: u64,
    pub entries: Vec<ComponentRelease>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRelease {
    pub kind: ComponentKind,
    pub version: String,
    pub target_os: TargetOs,
    pub architecture: Architecture,
    pub provider: String,
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub archive: ArchiveKind,
    pub executable_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetOs {
    MacOs,
    Windows,
    Linux,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Architecture {
    Aarch64,
    X86_64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchiveKind {
    Raw,
    Zip,
    TarGz,
    TarXz,
}

impl ComponentManifest {
    pub fn signed_payload(&self) -> Result<Vec<u8>, AppError> {
        serde_json::to_vec(&SignedManifest {
            schema_version: self.schema_version,
            manifest_version: self.manifest_version.clone(),
            generated_at_unix_ms: self.generated_at_unix_ms,
            entries: self.entries.clone(),
        })
        .map_err(|error| {
            AppError::new(ErrorCode::Unknown, "组件清单无法序列化。", false)
                .with_diagnostic(error.to_string())
        })
    }

    pub fn verify(&self, trusted_key: &[u8; 32]) -> Result<(), AppError> {
        self.validate()?;
        let key = VerifyingKey::from_bytes(trusted_key)
            .map_err(|error| manifest_error("组件清单信任密钥无效。", error.to_string()))?;
        let signature_bytes = hex::decode(&self.signature)
            .map_err(|error| manifest_error("组件清单签名格式无效。", error.to_string()))?;
        let signature = Signature::from_slice(&signature_bytes)
            .map_err(|error| manifest_error("组件清单签名格式无效。", error.to_string()))?;
        key.verify(&self.signed_payload()?, &signature)
            .map_err(|error| manifest_error("组件清单签名验证失败。", error.to_string()))
    }

    pub fn validate(&self) -> Result<(), AppError> {
        if self.schema_version != COMPONENT_MANIFEST_SCHEMA
            || self.manifest_version.trim().is_empty()
            || self.manifest_version.len() > 64
            || self.entries.is_empty()
            || self.entries.len() > 128
        {
            return Err(manifest_error(
                "组件清单版本或条目数量无效。",
                "manifest header rejected".into(),
            ));
        }
        let mut targets = std::collections::HashSet::new();
        for entry in &self.entries {
            if entry.version.trim().is_empty()
                || entry.provider.trim().is_empty()
                || entry.provider.len() > 128
                || !entry.url.starts_with("https://")
                || entry.url.len() > 4096
                || entry.sha256.len() != 64
                || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
                || entry.size_bytes == 0
                || entry.size_bytes > 2_000_000_000
                || entry.executable_name.is_empty()
                || entry.executable_name.contains('/')
                || entry.executable_name.contains('\\')
                || entry.executable_name.contains('\0')
            {
                return Err(manifest_error(
                    "组件清单包含无效或不安全的发行条目。",
                    entry.version.clone(),
                ));
            }
            if !targets.insert((entry.kind, entry.target_os, entry.architecture)) {
                return Err(manifest_error(
                    "组件清单包含重复的平台发行条目。",
                    entry.version.clone(),
                ));
            }
        }
        Ok(())
    }
}

fn manifest_error(message: &str, diagnostic: String) -> AppError {
    AppError::new(ErrorCode::Unknown, message, false).with_diagnostic(diagnostic)
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};

    use super::*;

    fn unsigned_manifest() -> ComponentManifest {
        ComponentManifest {
            schema_version: COMPONENT_MANIFEST_SCHEMA,
            manifest_version: "2026.10.1".into(),
            generated_at_unix_ms: 100,
            entries: vec![ComponentRelease {
                kind: ComponentKind::YtDlp,
                version: "2026.10.1".into(),
                target_os: TargetOs::MacOs,
                architecture: Architecture::Aarch64,
                provider: "yt-dlp GitHub Releases".into(),
                url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.1/yt-dlp_macos"
                    .into(),
                sha256: "a".repeat(64),
                size_bytes: 1024,
                archive: ArchiveKind::Raw,
                executable_name: "yt-dlp".into(),
            }],
            signature: String::new(),
        }
    }

    #[test]
    fn verifies_signature_and_rejects_payload_tampering() {
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let mut manifest = unsigned_manifest();
        manifest.signature = hex::encode(
            signing_key
                .sign(&manifest.signed_payload().unwrap())
                .to_bytes(),
        );
        assert!(
            manifest
                .verify(&signing_key.verifying_key().to_bytes())
                .is_ok()
        );
        manifest.entries[0].url = "https://attacker.invalid/evil".into();
        assert!(
            manifest
                .verify(&signing_key.verifying_key().to_bytes())
                .is_err()
        );
    }

    #[test]
    fn rejects_insecure_urls_bad_hashes_and_duplicate_targets() {
        let mut manifest = unsigned_manifest();
        manifest.entries[0].url = "http://example.com/tool".into();
        assert!(manifest.validate().is_err());
        manifest.entries[0].url = "https://example.com/tool".into();
        manifest.entries[0].sha256 = "bad".into();
        assert!(manifest.validate().is_err());
    }
}
