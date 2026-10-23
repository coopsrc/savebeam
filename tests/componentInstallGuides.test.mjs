import assert from "node:assert/strict";
import test from "node:test";
import {
  installationPlatform,
  componentRecommendation,
} from "../src/features/settings/componentInstallGuides.ts";

test("manual installation commands and FFmpeg links match each desktop platform", () => {
  for (const [platform, prefix, anchor] of [
    ["macos", "brew install ", "build-mac"],
    ["windows", "winget install --id ", "build-windows"],
    ["linux", "sudo apt-get install ", "build-linux"],
  ]) {
    for (const kind of ["yt_dlp", "ffmpeg", "ffprobe"]) {
      assert.ok(componentRecommendation(kind, platform).command.startsWith(prefix));
    }
    assert.equal(
      installationPlatform(platform).ffmpegUrl,
      `https://ffmpeg.org/download.html#${anchor}`,
    );
    assert.equal(
      componentRecommendation("ffmpeg", platform).command,
      componentRecommendation("ffprobe", platform).command,
    );
  }
});

test("runtime advice preserves platform-specific installation and Linux limitations", () => {
  assert.equal(componentRecommendation("javascript_runtime", "macos").command, "brew install deno");
  assert.equal(
    componentRecommendation("javascript_runtime", "windows").command,
    "winget install --id DenoLand.Deno -e",
  );
  const linux = componentRecommendation("javascript_runtime", "linux");
  assert.equal(linux.command, undefined);
  assert.match(linux.note, /没有官方 apt 源/);
  assert.match(linux.url, /^https:\/\/docs\.deno\.com\//);
  assert.match(installationPlatform("linux").note, /仅为 Ubuntu\/Debian 示例/);
  assert.match(installationPlatform("macos").note, /Homebrew/);
  assert.match(installationPlatform("windows").note, /PowerShell/);
});
