//! Hash verification and allowlisted, single-file component archive extraction.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::domain::{
    component_manifest::ArchiveKind,
    error::{AppError, ErrorCode},
};

const MAX_ARCHIVE_BYTES: u64 = 2_000_000_000;
const MAX_EXECUTABLE_BYTES: u64 = 500_000_000;

pub fn verify_sha256(path: &Path, expected_hex: &str) -> Result<(), AppError> {
    if expected_hex.len() != 64 || !expected_hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid_artifact("组件清单中的 SHA-256 格式无效。"));
    }
    let metadata =
        fs::metadata(path).map_err(|error| artifact_io("无法读取组件下载文件。", error))?;
    if !metadata.is_file() || metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(invalid_artifact("组件下载文件类型或大小不安全。"));
    }
    let mut file =
        File::open(path).map_err(|error| artifact_io("无法读取组件下载文件。", error))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| artifact_io("无法校验组件下载文件。", error))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    if hex::encode(digest.finalize()) != expected_hex.to_ascii_lowercase() {
        return Err(invalid_artifact("组件文件校验失败，已拒绝安装。"));
    }
    Ok(())
}

pub fn extract_executable(
    archive_path: &Path,
    kind: ArchiveKind,
    executable_name: &str,
    staging_directory: &Path,
) -> Result<PathBuf, AppError> {
    if executable_name.is_empty()
        || executable_name.contains('/')
        || executable_name.contains('\\')
        || executable_name.contains('\0')
    {
        return Err(invalid_artifact("组件清单中的可执行文件名称无效。"));
    }
    fs::create_dir_all(staging_directory)
        .map_err(|error| artifact_io("无法创建组件暂存目录。", error))?;
    let destination = staging_directory.join(executable_name);
    if destination.exists() {
        return Err(invalid_artifact("组件暂存文件已存在。"));
    }
    let extraction = (|| {
        match kind {
            ArchiveKind::Raw => {
                let input = File::open(archive_path)
                    .map_err(|error| artifact_io("无法打开组件文件。", error))?;
                copy_bounded(input, &destination)?;
            }
            ArchiveKind::Zip => extract_zip(archive_path, executable_name, &destination)?,
            ArchiveKind::TarGz => {
                let input = File::open(archive_path)
                    .map_err(|error| artifact_io("无法打开组件压缩包。", error))?;
                extract_tar(
                    flate2::read::GzDecoder::new(input),
                    executable_name,
                    &destination,
                )?;
            }
            ArchiveKind::TarXz => {
                let input = File::open(archive_path)
                    .map_err(|error| artifact_io("无法打开组件压缩包。", error))?;
                extract_tar(
                    xz2::read::XzDecoder::new(input),
                    executable_name,
                    &destination,
                )?;
            }
        }
        set_executable_permissions(&destination)
    })();
    if let Err(error) = extraction {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(destination)
}

fn extract_zip(path: &Path, executable_name: &str, destination: &Path) -> Result<(), AppError> {
    let input = File::open(path).map_err(|error| artifact_io("无法打开组件压缩包。", error))?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| invalid_archive(error.to_string()))?;
    let mut found = false;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| invalid_archive(error.to_string()))?;
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry
            .name()
            .map_err(|error| invalid_archive(error.to_string()))?;
        let Some(name) = entry_name.rsplit(['/', '\\']).next() else {
            continue;
        };
        if name != executable_name {
            continue;
        }
        if found
            || entry.size() > MAX_EXECUTABLE_BYTES
            || entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(invalid_artifact(
                "组件压缩包中的目标文件重复、过大或为符号链接。",
            ));
        }
        copy_bounded(&mut entry, destination)?;
        found = true;
    }
    if !found {
        return Err(invalid_artifact("组件压缩包中找不到指定的可执行文件。"));
    }
    Ok(())
}

fn extract_tar<R: Read>(
    reader: R,
    executable_name: &str,
    destination: &Path,
) -> Result<(), AppError> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|error| invalid_archive(error.to_string()))?;
    let mut found = false;
    for entry in entries {
        let mut entry = entry.map_err(|error| invalid_archive(error.to_string()))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .map_err(|error| invalid_archive(error.to_string()))?;
        if path.file_name().and_then(|name| name.to_str()) != Some(executable_name) {
            continue;
        }
        if found || entry.size() > MAX_EXECUTABLE_BYTES {
            return Err(invalid_artifact("组件压缩包中的目标文件重复或过大。"));
        }
        copy_bounded(&mut entry, destination)?;
        found = true;
    }
    if !found {
        return Err(invalid_artifact("组件压缩包中找不到指定的可执行文件。"));
    }
    Ok(())
}

fn copy_bounded(mut input: impl Read, destination: &Path) -> Result<(), AppError> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| artifact_io("无法创建组件暂存文件。", error))?;
    let mut total = 0u64;
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let count = input
            .read(&mut buffer)
            .map_err(|error| artifact_io("组件解压失败。", error))?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_EXECUTABLE_BYTES {
            return Err(invalid_artifact("解压后的组件超过安全大小限制。"));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| artifact_io("组件暂存文件写入失败。", error))?;
    }
    if total == 0 {
        return Err(invalid_artifact("解压得到的组件文件为空。"));
    }
    output
        .flush()
        .and_then(|()| output.sync_all())
        .map_err(|error| artifact_io("组件暂存文件无法保存。", error))?;
    Ok(())
}

#[cfg(unix)]
fn set_executable_permissions(path: &Path) -> Result<(), AppError> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
        .map_err(|error| artifact_io("无法设置组件可执行权限。", error))
}

#[cfg(not(unix))]
fn set_executable_permissions(_path: &Path) -> Result<(), AppError> {
    Ok(())
}

fn invalid_artifact(message: &str) -> AppError {
    AppError::new(ErrorCode::Unknown, message, false)
}
fn invalid_archive(diagnostic: String) -> AppError {
    invalid_artifact("组件压缩包无效。").with_diagnostic(diagnostic)
}
fn artifact_io(message: &str, error: std::io::Error) -> AppError {
    AppError::new(ErrorCode::InvalidPath, message, false).with_diagnostic(error.to_string())
}

#[cfg(test)]
mod tests {
    use sha2::Digest;
    use std::{
        fs::File,
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{extract_executable, verify_sha256};
    use crate::domain::component_manifest::ArchiveKind;

    fn temp_dir() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "savebeam-archive-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn verifies_digest_before_extraction() {
        let root = temp_dir();
        let archive = root.join("raw.bin");
        std::fs::write(&archive, b"trusted binary").unwrap();
        let digest = hex::encode(sha2::Sha256::digest(b"trusted binary"));
        assert!(verify_sha256(&archive, &digest).is_ok());
        assert!(verify_sha256(&archive, &"0".repeat(64)).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn extracts_only_to_staging_path_and_rejects_symlink_entries() {
        let root = temp_dir();
        let zip_path = root.join("component.zip");
        let mut zip = zip::ZipWriter::new(File::create(&zip_path).unwrap());
        zip.start_file(
            "../outside/yt-dlp",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"binary").unwrap();
        zip.finish().unwrap();
        assert!(
            zip_path.exists(),
            "archive must exist before extraction: {}",
            zip_path.display()
        );
        let staging = root.join("stage");
        let executable =
            extract_executable(&zip_path, ArchiveKind::Zip, "yt-dlp", &staging).unwrap();
        assert_eq!(executable, staging.join("yt-dlp"));
        assert_eq!(std::fs::read(executable).unwrap(), b"binary");
        assert!(!root.join("outside/yt-dlp").exists());

        let _ = std::fs::remove_dir_all(root);
    }
}
