// Platform profile previews, not native Windows/Linux acceptance.
/* global window */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
try {
  for (const [platform, label, width, height] of [
    ["macos", "macOS", 216, 34],
    ["windows", "Windows", 232, 42],
    ["linux", "Linux", 224, 40],
  ]) {
    for (const viewportWidth of [1280, 800])
      for (const colorScheme of ["light", "dark"]) {
        const page = await browser.newPage({
          viewport: { width: viewportWidth, height: 900 },
          colorScheme,
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          window.isTauri = true;
          window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
          window.__TAURI_INTERNALS__ = {
            transformCallback() {
              return 1;
            },
            unregisterCallback() {},
            async invoke(command) {
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
              if (command === "get_network_preferences")
                return { proxyMode: "default", proxyUrl: "" };
              if (command === "get_cookie_preferences")
                return { cookiesFilePath: null, cookiesBrowser: null, accessConfirmed: false };
              if (command === "get_download_preferences")
                return { outputDirectory: "", maxConcurrent: 1, conflictStrategy: "skip" };
              if (command.startsWith("plugin:event|")) return 1;
              return [];
            },
          };
        });
        await page.goto(`${base}#/download`);
        await page.locator(".dev-platform-switcher").getByText(label, { exact: true }).click();
        await page
          .locator(`.app-root[data-platform="${platform}"][data-selection-style="rounded-fill"]`)
          .waitFor();
        await page.locator(".app-sidebar").evaluate(async (element) => {
          await Promise.all(
            element.getAnimations().map((animation) => animation.finished.catch(() => {})),
          );
        });
        for (const route of ["任务", "设置", "下载"]) {
          await page.getByRole("link", { name: route, exact: true }).click();
          await page.locator(`.sidebar-link[data-active][aria-label="${route}"]`).waitFor();
          await page.mouse.move(0, 0);
          const selected = page.locator(".sidebar-link[data-active]");
          assert.equal(await selected.count(), 1);
          assert.equal(await selected.getAttribute("aria-label"), route);
          const style = await selected.evaluate((element) => ({
            radius: window.getComputedStyle(element).borderRadius,
            background: window.getComputedStyle(element).backgroundColor,
            before: window.getComputedStyle(element, "::before").content,
            height: window.getComputedStyle(element).minHeight,
          }));
          assert.equal(style.radius, "10px");
          assert.equal(
            style.background,
            colorScheme === "dark" ? "rgba(10, 93, 203, 0.24)" : "rgb(232, 241, 255)",
          );
          assert.equal(style.before, "none");
          assert.equal(style.height, `${height}px`);
        }
        const sidebar = await page.locator(".app-sidebar").boundingBox();
        assert.ok(Math.abs(sidebar.width - (viewportWidth >= 960 ? width : 56)) <= 1);
        assert.deepEqual(errors, []);
        if (viewportWidth === 1280 && colorScheme === "light")
          await page.screenshot({ path: `/tmp/savebeam-sidebar-${platform}.png` });
        process.stdout.write(`${platform} ${viewportWidth} ${colorScheme}: passed\n`);
        await page.close();
      }
  }
} finally {
  await browser.close();
}
