// Isolated settings IPC fixtures. No user settings or network downloads.
/* global window */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import process from "node:process";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const locale of ["zh-CN", "en-US"]) {
    const en = locale === "en-US";
    const page = await browser.newPage({
      locale,
      viewport: { width: 1280, height: 800 },
      colorScheme: en ? "dark" : "light",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.isTauri = true;
      window.fixture = {
        saved: [],
        fail: false,
        value: { metadataTotal: 4, metadataPerList: 2, downloadTasks: 2, videosPerTask: 2 },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          if (command === "get_concurrency_preferences") return window.fixture.value;
          if (command === "save_concurrency_preferences") {
            if (window.fixture.fail)
              throw { code: "unknown", message: "fixture save failed", retryable: true };
            window.fixture.saved.push(args.preferences);
            return (window.fixture.value = args.preferences);
          }
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
          if (command === "get_cookie_preferences")
            return { cookiesFilePath: null, cookiesBrowser: null, accessConfirmed: false };
          if (command === "get_network_preferences") return { proxyMode: "direct", proxyUrl: "" };
          if (
            command === "get_component_status" ||
            command === "get_download_history" ||
            command === "get_download_tasks"
          )
            return [];
          return null;
        },
      };
    });
    await page.goto("http://127.0.0.1:1421/#/settings");
    const total = page.getByRole("textbox", {
      name: en ? "Total metadata concurrency" : "信息读取总并发数",
      exact: true,
    });
    await total.waitFor();
    await total.fill("5");
    await page.getByRole("link", { name: en ? "History" : "历史", exact: true }).click();
    await page.getByRole("link", { name: en ? "Settings" : "设置", exact: true }).click();
    assert.equal(await total.inputValue(), "5");
    assert.equal(await page.evaluate(() => window.fixture.saved.length), 0);
    await page
      .getByRole("button", { name: en ? "Save concurrency settings" : "保存并发设置", exact: true })
      .click();
    await page.waitForFunction(() => window.fixture.saved.length === 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.saved[0]), {
      metadataTotal: 5,
      metadataPerList: 2,
      downloadTasks: 2,
      videosPerTask: 2,
    });
    await page.evaluate(() => (window.fixture.fail = true));
    await total.fill("6");
    await page
      .getByRole("button", { name: en ? "Save concurrency settings" : "保存并发设置", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: /fixture save failed|operation|操作/ })
      .waitFor();
    assert.equal(await page.evaluate(() => window.fixture.saved.length), 1);
    await page.screenshot({ path: `/tmp/savebeam-concurrency-${locale}.png` });
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      `${locale}: concurrency settings, retained draft, persisted limits and failed-save isolation passed\n`,
    );
  }
} finally {
  await browser.close();
}
