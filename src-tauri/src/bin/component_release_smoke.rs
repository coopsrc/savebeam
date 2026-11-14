//! Explicit operator-run native binary smoke in a fresh, isolated directory. Never used by UI.
use savebeam_lib::{
    domain::{
        component::ComponentStatus,
        component_manifest::{ComponentManifest, current_target},
        error::ErrorCode,
    },
    infrastructure::ytdlp_process::CancellationToken,
    services::{
        component_archive::{extract_executable, verify_sha256},
        component_download::download_to_temp,
        component_installer::install_component,
        component_paths::ComponentPaths,
    },
};
use std::{env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.len() != 3 && !(args.len() == 4 && args[3].to_str() == Some("--download-missing")) {
        return Err("usage: component_release_smoke <unsigned-candidate> <asset-cache> <new-smoke-directory> [--download-missing]".into());
    }
    let manifest: ComponentManifest = serde_json::from_slice(&fs::read(&args[0])?)?;
    manifest.validate()?;
    let cache = PathBuf::from(&args[1]);
    let root = PathBuf::from(&args[2]);
    fs::create_dir(&root)?; // Existing directories are refused, protecting all user installations.
    let paths = ComponentPaths::from_app_data_dir(&root);
    let target = current_target()?;
    let mut checked = 0;
    for release in manifest
        .entries
        .iter()
        .filter(|r| (r.target_os, r.architecture) == target)
    {
        let name = release.url.rsplit('/').next().ok_or("invalid URL")?;
        let archive = cache.join(name);
        if !archive.is_file() && args.len() == 4 {
            fs::create_dir_all(&cache)?;
            download_to_temp(release, &archive, &CancellationToken::default(), |_| {})?;
        }
        if !archive.is_file() {
            return Err(format!("native asset missing: {name}").into());
        }
        if fs::metadata(&archive)?.len() != release.size_bytes {
            return Err("asset size mismatch".into());
        }
        verify_sha256(&archive, &release.sha256)?;
        assert!(verify_sha256(&archive, &"00".repeat(32)).is_err());
        let cancelled_path = root.join(format!("cancel-{checked}"));
        let token = CancellationToken::default();
        let error = download_to_temp(release, &cancelled_path, &token, |_| token.cancel())
            .expect_err("first packet should trigger cancellation");
        if error.code != ErrorCode::Cancelled || cancelled_path.exists() {
            return Err("network cancellation did not clean partial artifact".into());
        }
        let directory = paths.ensure_component_dir(release.kind)?;
        let stage = directory.join("first-stage");
        let executable =
            extract_executable(&archive, release.archive, &release.executable_name, &stage)?;
        let installed = install_component(&executable, release.kind, &paths)?;
        if installed.status != ComponentStatus::Available {
            return Err("native component probe failed".into());
        }
        let current = installed.executable_path.ok_or("missing executable path")?;
        let before = fs::read(&current)?;
        // A real executable replaces a real installed version; then an invalid replacement rolls back.
        let update = extract_executable(
            &archive,
            release.archive,
            &release.executable_name,
            &directory.join("update-stage"),
        )?;
        install_component(&update, release.kind, &paths)?;
        let invalid_dir = directory.join("invalid-stage");
        fs::create_dir(&invalid_dir)?;
        let invalid = invalid_dir.join(&release.executable_name);
        fs::write(&invalid, b"invalid native executable")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&invalid, fs::Permissions::from_mode(0o755))?;
        }
        if install_component(&invalid, release.kind, &paths).is_ok() {
            return Err("invalid component was accepted".into());
        }
        if fs::read(&current)? != before {
            return Err("rollback changed the installed executable".into());
        }
        println!(
            "{:?}: SHA-256, live network cancellation/cleanup, extraction, native probe {:?}, replacement and failed-health-check rollback passed",
            release.kind, installed.version
        );
        checked += 1;
    }
    if checked == 0 {
        return Err("no native candidates".into());
    }
    Ok(())
}
