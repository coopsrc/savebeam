# Component catalog: local release preparation

Updated: 2026-10-21

Status: prepared locally; **not signed with the production key and not published**.

This document tracks the candidate component matrix and the release controls. The candidate JSON is `release/components.unsigned.json`; it is input data, not a trusted catalog. Do not rename it to `components.json`, attach it to a Release, or treat it as production-ready before the open checks below are resolved.

## Candidate matrix

| Component        | Candidate version | Targets                                             | Upstream/provider                                                                          | State                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| yt-dlp           | 2026.08.19        | macOS x64/arm64, Windows x64/arm64, Linux x64/arm64 | [yt-dlp official GitHub Release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19) | Candidate URLs, asset sizes and SHA-256 values recorded; archive contents and runtime smoke tests remain to be done.                                                                                                                                                                                    |
| Deno             | 2.9.7             | macOS, Windows, Linux; x64/arm64                    | [Deno official GitHub Release](https://github.com/denoland/deno/releases/tag/v2.9.7)       | Candidate URLs, asset sizes and SHA-256 values recorded; extract layout and runtime smoke tests remain to be done.                                                                                                                                                                                      |
| FFmpeg / ffprobe | FFmpeg 9.0 branch | Windows x64/arm64, Linux x64/arm64                  | [BtbN FFmpeg Builds](https://github.com/BtbN/FFmpeg-Builds/releases), LGPL static variant  | Provisional only: `latest` is a floating URL; pin an immutable release asset and re-verify its digest before signing. Review the exact build configuration, included dependencies, notices and source-offer obligations.                                                                                |
| FFmpeg / ffprobe | —                 | macOS x64/arm64                                     | System installation or user-selected executable path                                       | Intentional policy: do not offer app-managed macOS FFmpeg downloads. Detect Homebrew/system installations and let users set custom executable paths. The supplied evermeet URL and its mirror are Intel-only and its build enables GPL/version3 components; they are not selected for the managed catalog. |

The candidate SHA-256 and byte counts are copied from GitHub Release asset metadata queried on 2026-10-21. They must be checked again against the exact immutable URLs used for the eventual signed catalog. In particular, a digest attached to a floating URL does not make that URL reproducible: once the upstream asset changes, the app must reject it, and the catalog needs a new reviewed digest.

### Source and licensing notes

- FFmpeg's [download page](https://www.ffmpeg.org/download.html) distributes source and links to external build providers; third-party binaries are not FFmpeg-official builds. The UI must name the actual provider.
- BtbN describes its builds as daily automatic builds. The LGPL variant omits GPL-only libraries (notably x264/x265), but the exact binary's configuration and notices still need review. This is not a legal conclusion or a substitute for a distribution compliance review.
- Do not substitute [Gyan's Windows builds](https://www.gyan.dev/ffmpeg/builds/) without updating the license review: its build page identifies those builds as GPLv3.
- The researched [evermeet macOS package](https://evermeet.cx/ffmpeg/) and its mirror are Intel-only; its [Apple Silicon note](https://evermeet.cx/ffmpeg/apple-silicon-arm) says it does not provide a native ARM build. The package also enables GPL, x264/x265 and version3 components. Savebeam therefore uses Homebrew/system detection or a user-selected executable path on macOS instead of an app-managed download.
- Keep source links and the applicable license/notice bundle with any eventual Savebeam Release. Have counsel or the project license owner review obligations before distributing binaries.

## Local signing workflow

`scripts/sign-component-manifest.sh <unsigned.json> <private-key.pem> <output.json>` validates the unsigned manifest using the Rust model, signs its canonical payload with OpenSSL Ed25519, writes the detached signature into the JSON, then verifies the result against the public key embedded in the application. It refuses to overwrite the output file. The helper requires `cargo`, `openssl`, `jq`, and `xxd`; the private-key path must be controlled by the operator and must never be committed or printed.

`.github/workflows/publish-component-catalog.yml` is a manual workflow intended for a later release. It checks out `main`, requires the `component-catalog-release` GitHub Environment, reads `SAVEBEAM_COMPONENT_MANIFEST_SIGNING_KEY`, signs the checked-in candidate, and uploads only `components.json` to an **existing** Release. It does not create a Release. Before using it, configure required reviewers/branch restrictions for that environment and verify the secret/public-key pair. The workflow is restricted to dispatches from `main`; `contents: write` is scoped to the job.

Local verification can be run without production credentials:

```sh
jq empty release/components.unsigned.json
bash -n scripts/sign-component-manifest.sh
cargo run --locked --manifest-path src-tauri/Cargo.toml --bin component_manifest_payload -- release/components.unsigned.json >/dev/null
```

Do not use the real signing key for routine tests. A temporary test key should only be used to confirm that signature generation works; because it will not match the app's pinned public key, the final verification step is expected to reject it.

## Before any public catalog release

1. Replace every floating asset URL with an immutable, reviewed URL; verify version, architecture, archive contents, asset size and SHA-256 from the downloaded bytes.
2. Keep macOS FFmpeg/ffprobe outside the app-managed download matrix by design; validate Homebrew/system detection and custom executable paths on macOS.
3. Smoke-test each real binary on its target OS/architecture, including Deno-backed yt-dlp extraction and FFmpeg/ffprobe health checks; verify archive path behavior and cancellation/retry/update/rollback.
4. Complete a dependency/build-configuration, license and notices review for each binary; publish source/offer materials where required.
5. Protect the GitHub Environment, verify the configured private key corresponds to the public key shipped by the application, and review the exact catalog diff before signing.
6. Create a versioned Savebeam Release deliberately, run the manual workflow to attach `components.json`, then test the production app against that asset. Only after these checks may M6 be accepted.

## Current gate

No GitHub Release was created or modified for this preparation. M6 remains in progress: there is no signed catalog asset and app-managed binary installation has not been tested end to end. macOS FFmpeg/ffprobe are intentionally provided through Homebrew/system detection or a user-selected executable path, not the managed catalog. See [`../verification/M6.md`](../verification/M6.md) and [`../implementation-plan.md`](../implementation-plan.md).
