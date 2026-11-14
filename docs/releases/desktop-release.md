# Desktop release preparation

Updated: 2026-11-14. Targets: macOS Apple Silicon (12+), Windows x64. Linux remains a development/preview target until its GTK security and native checks are resolved.

## Build candidates

`.github/workflows/release.yml` runs under the `desktop-release` environment. Manual dispatch from `main` selects signing mode and exports candidates only; pushing a version tag runs both platform builds and publishes their exact-tag artifacts to GitHub Releases. It runs locked checks, regenerates/rechecks notices, packages both platforms, verifies updater signatures and uploads Actions artifacts for 14 days. Tagged builds also require matching package.json/Cargo.toml/Cargo.lock versions and a nonempty version-specific release note. Configure environment reviewers and allow the intended `main`/version-tag refs before giving it production credentials.

- `unsigned` (default and current tag builds): macOS ad-hoc signing and unsigned Windows NSIS. The user explicitly authorized public manual downloads for 0.1.0 without OS credentials; notes must disclose that status. Updater packages still require their separate Minisign key. Metadata explicitly says OS signature verification has not passed; no production updater manifest is emitted.
- `signed`: requires Developer ID Application plus notarization on macOS and a usable Windows code-signing PFX. Missing credentials fail closed. macOS checks `codesign`, stapling and `spctl`; Windows checks Authenticode. Only successful checks mark `osSignatureVerified`.
- Windows uses a per-user NSIS installer, English/Simplified Chinese, SHA-256 timestamped signing when enabled, and blocks installer downgrades. WebView2 may be installed by its standard bootstrapper if absent.
- LICENSE, NOTICE and offline third-party notices are bundled under `legal/` and exported with artifacts. Development verification/signing helpers are behind `release-tools`, excluded from the application bundle.

## Credential names

| Purpose                           | GitHub secret                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| App updater signature             | `TAURI_SIGNING_PRIVATE_KEY`, optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                                          |
| macOS certificate                 | `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (Developer ID Application) |
| Apple notary API                  | `APPLE_API_ISSUER`, `APPLE_API_KEY` (key ID), `APPLE_API_KEY_CONTENT` (P8)                                          |
| Windows certificate               | `WINDOWS_CERTIFICATE` (base64 PFX), `WINDOWS_CERTIFICATE_PASSWORD`                                                  |
| Component manifest (separate key) | `SAVEBEAM_COMPONENT_MANIFEST_SIGNING_KEY`                                                                           |

Updater Minisign signing is distinct from OS code signing and component manifest signing. The updater private key was generated outside the repository in the operator's private configuration directory, mode 0600, and stored in its GitHub Secret. Keep an offline private backup; the public key is pinned in `tauri.conf.json`. Do not print secrets or attach keys/logs to issues. No Developer ID/notary or Windows signing credentials currently exist in this session.

## Local macOS internal build

```sh
node scripts/prepare-release.mjs darwin unsigned /tmp/savebeam-release.json
# Supply TAURI_SIGNING_PRIVATE_KEY through a secure environment or private file path.
pnpm tauri build --config /tmp/savebeam-release.json -- --locked
node scripts/verify-release-signatures.mjs src-tauri/target/release/bundle
node scripts/collect-release.mjs src-tauri/target/release/bundle /tmp/savebeam-candidate darwin unsigned
```

Output directories must not already exist. Unsigned packages are not offered by the production updater. A valid Minisign signature does not replace Gatekeeper/SmartScreen requirements.

## Version tags and public manual downloads

Use `main` for ongoing development. Every release gets a permanent annotated `vMAJOR.MINOR.PATCH` tag; do not move/reuse it or replace its published assets. A release branch is unnecessary while maintaining one version line. For parallel fixes to an older line, create a maintenance branch from its tag and publish a new patch tag.

For each subsequent version (for example 0.1.1):

1. Update `package.json`, `src-tauri/Cargo.toml`, and the Savebeam package in `src-tauri/Cargo.lock` together; run Cargo to refresh its lock entry.
2. Add `docs/releases/notes/0.1.1.md`, including platform support, installation/signing status, changes and limitations. Run `pnpm check` and review/commit to `main`; wait for CI success.
3. Create and push the release tag on that exact commit:

   ```sh
   git tag -a v0.1.1 -m 'Savebeam 0.1.1'
   git push origin v0.1.1
   ```

4. Follow the tag's release workflow until both build jobs and publication succeed. The publisher downloads artifacts from its own run, rejects a different commit/version, mismatched bytes/legal text, missing platforms or unexpected files, and stages only known assets with combined `build-info.json` / `SHA256SUMS`.
5. A draft receives all assets first. The publisher verifies the uploaded names/sizes before marking it public/Latest. An existing release or incomplete draft stops the workflow; investigate it instead of overwriting. Download published assets and verify checksums afterwards.

This path only publishes manual downloads. It never runs the component-catalog publishing workflow and never generates `latest.json`; those retain their separate acceptance gates. Release assets are long-lived downloads, unlike expiring Actions artifacts. See [GitHub's release instructions](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

## Update metadata and publication

After native signing/installation acceptance passes, obtain both signed artifacts from the same reviewed commit. Recheck `build-info.json`, hashes, version and updater signatures, then run:

```sh
node scripts/assemble-update.mjs /path/to/mac-candidate /path/to/windows-candidate /tmp/latest.json
```

This command re-verifies the pinned key and announced version. It refuses unsigned/unverified OS packages, missing platforms, changed bytes and signatures without version binding. It only creates a local file. Review release notes and deliberately attach packages, signatures, SHA256SUMS, notices and `latest.json` to a `v<version>` Release. The app uses the fixed latest-release asset URL; draft/prerelease assets do not constitute a production update channel.

Before publishing production automatic updates close the binary-notice reviews, native checks and [acceptance matrix](../verification/desktop-release.md). The initial manually downloadable release retains documented unsigned/acceptance limitations; publishing it does not mark M6/M7/M8 complete. App release and component-catalog publication are separate explicit actions. Never replace a pinned key to work around a missing private key.

## Rollback and uninstall

Back up app data with SQLite's consistent backup API and preserve media separately. A previous application may not understand a later schema; restore its matching data snapshot as well as the old binary. Automatic updater downgrade is not offered.

On macOS remove the application bundle; app data and downloaded media remain unless deliberately removed. On Windows use the per-user uninstaller and review any data-removal option. Never recursively delete a download directory to uninstall Savebeam. Verify these actions in disposable profiles before public release.
