import assert from "node:assert/strict";
import test from "node:test";
import { getPlatformProfile } from "../src/app/platform/profiles.ts";

test("all desktop profiles share expanded/compact sidebar and navigation dimensions", () => {
  for (const platform of ["macos", "windows", "linux"]) {
    const profile = getPlatformProfile(platform);
    assert.equal(profile.sidebarWidth, 216, platform);
    assert.equal(profile.compactSidebarWidth, 56, platform);
    assert.equal(profile.navigationItemHeight, 34, platform);
    assert.equal(profile.selectionStyle, "rounded-fill", platform);
  }
});

test("shared navigation dimensions do not erase platform fonts, shortcuts or file-manager labels", () => {
  const mac = getPlatformProfile("macos");
  const windows = getPlatformProfile("windows");
  const linux = getPlatformProfile("linux");
  assert.equal(mac.modifierKey, "Meta");
  assert.equal(windows.modifierKey, "Control");
  assert.equal(linux.modifierKey, "Control");
  assert.match(mac.systemFont, /-apple-system/);
  assert.match(windows.systemFont, /Segoe UI/);
  assert.match(linux.systemFont, /Noto Sans/);
  assert.equal(mac.revealFileLabel, "在 Finder 中显示");
  assert.equal(windows.revealFileLabel, "在文件资源管理器中显示");
  assert.equal(linux.revealFileLabel, "在文件管理器中显示");
});
