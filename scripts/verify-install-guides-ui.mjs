// Local IPC and clipboard fixtures only; never installs components or writes system clipboard.
/* global window, navigator */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
const specs = [
  [
    "macOS",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "brew install yt-dlp",
    "build-mac",
    4,
  ],
  [
    "Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "winget install --id yt-dlp.yt-dlp -e",
    "build-windows",
    4,
  ],
  ["Linux", "Mozilla/5.0 (X11; Linux x86_64)", "sudo apt-get install yt-dlp", "build-linux", 3],
];
try {
  for (const [label, userAgent, command, anchor, copyCount] of specs) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.isTauri = true;
      window.guideFixture = { copied: [], calls: [] };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          async writeText(text) {
            window.guideFixture.copied.push(text);
          },
        },
      });
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          window.guideFixture.calls.push({ command, args });
          if (command === "get_component_status")
            return ["yt_dlp", "ffmpeg", "ffprobe", "javascript_runtime"].map((kind) => ({
              kind,
              status: "missing",
              source: null,
              executablePath: null,
              version: null,
            }));
          if (command === "get_download_preferences")
            return { outputDirectory: "", maxConcurrent: 1, conflictStrategy: "skip" };
          if (command === "get_download_option_defaults")
            return {
              audioOnly: false,
              subtitleLanguages: [],
              writeAutomaticSubtitles: false,
              writeThumbnail: false,
              writeInfoJson: false,
              embedMetadata: false,
              keepIntermediateFiles: false,
            };
          if (command.startsWith("plugin:event|")) return 1;
          return [];
        },
      };
    });
    await page.goto(`${base}#/settings`);
    await page.getByRole("tab", { name: "运行组件", exact: true }).click();
    const guide = page.getByRole("region", { name: "手动安装建议", exact: true });
    await guide.getByText(command, { exact: true }).waitFor();
    assert.match(await guide.innerText(), new RegExp(`当前为 ${label}`));
    assert.equal(
      await guide
        .getByRole("link", { name: `FFmpeg 官网 ${label} 下载入口`, exact: true })
        .getAttribute("href"),
      `https://ffmpeg.org/download.html#${anchor}`,
    );
    assert.equal(await guide.getByRole("button", { name: /安装命令/ }).count(), copyCount);
    const copy = guide.getByRole("button", { name: "复制 yt-dlp 安装命令", exact: true });
    await copy.click();
    assert.equal(await copy.innerText(), "已复制");
    assert.equal((await page.evaluate(() => window.guideFixture.copied)).at(-1), command);
    if (label === "macOS") {
      for (const [target, , targetCommand, targetAnchor] of specs.slice(1)) {
        await page.locator(".dev-platform-switcher label").filter({ hasText: target }).click();
        await guide.getByText(targetCommand, { exact: true }).waitFor();
        assert.equal(await copy.innerText(), "复制命令");
        await copy.click();
        assert.equal((await page.evaluate(() => window.guideFixture.copied)).at(-1), targetCommand);
        assert.equal(
          await guide
            .getByRole("link", { name: `FFmpeg 官网 ${target} 下载入口`, exact: true })
            .getAttribute("href"),
          `https://ffmpeg.org/download.html#${targetAnchor}`,
        );
      }
      await page.locator(".dev-platform-switcher label").filter({ hasText: "自动" }).click();
      await guide.getByText(command, { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    assert.ok(
      !(await page.evaluate(() => window.guideFixture.calls)).some((call) =>
        /install|save|remove/.test(call.command),
      ),
    );
    await context.close();
    process.stdout.write(
      `${label}: automatic platform guide, correct command copy and FFmpeg destination passed\n`,
    );
  }
} finally {
  await browser.close();
}
