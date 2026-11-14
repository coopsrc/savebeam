// Local IPC fixtures: no update servers, installers or user data are touched.
/* global window, document */
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
    const page = await browser.newPage({ locale, viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.isTauri = true;
      const f = (window.fixture = {
        calls: [],
        callbacks: {},
        handlers: {},
        counter: 0,
        update: null,
        fail: false,
        finish: null,
      });
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback(fn) {
          const id = ++f.counter;
          f.callbacks[id] = fn;
          return id;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          f.calls.push({ command, args });
          if (command === "plugin:event|listen") {
            f.handlers[args.event] = args.handler;
            return 1;
          }
          if (command === "get_app_information")
            return { version: "0.1.0", platform: "macos", architecture: "aarch64" };
          if (command === "check_app_update") {
            if (f.fail)
              throw {
                code: "network_failure",
                message: "暂时无法读取应用更新，请检查网络或稍后重试。",
                retryable: true,
              };
            return f.update;
          }
          if (command === "install_app_update")
            return new Promise((resolve, reject) => {
              f.finish = reject;
            });
          if (command === "cancel_app_update") {
            f.finish({ code: "cancelled", message: "已取消应用更新下载。", retryable: true });
            return null;
          }
          if (command === "get_download_preferences")
            return { outputDirectory: "", maxConcurrent: 1, conflictStrategy: "skip" };
          if (command === "get_concurrency_preferences")
            return { metadataTotal: 4, metadataPerList: 2, downloadTasks: 2, videosPerTask: 2 };
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
            ["get_component_status", "get_download_tasks", "get_download_history"].includes(command)
          )
            return [];
          return null;
        },
      };
    });
    await page.goto("http://127.0.0.1:1421/#/settings");
    await page.getByRole("tab", { name: en ? "About" : "关于", exact: true }).click();
    const check = page.getByRole("button", {
      name: en ? "Check app updates" : "检查应用更新",
      exact: true,
    });
    await check.waitFor();
    assert.equal(
      await page.evaluate(
        () => window.fixture.calls.filter((c) => c.command === "check_app_update").length,
      ),
      0,
    );
    await check.click();
    await page
      .getByText(en ? "You are up to date." : "当前已是最新版本。", { exact: true })
      .waitFor();
    await page.evaluate(
      () =>
        (window.fixture.update = {
          version: "0.2.0",
          currentVersion: "0.1.0",
          notes: "<b>plain release notes</b>",
        }),
    );
    await check.click();
    const install = page.getByRole("button", {
      name: en ? "Download and install 0.2.0" : "下载并安装 0.2.0",
      exact: true,
    });
    await install.waitFor();
    await page.getByText("<b>plain release notes</b>", { exact: true }).waitFor();
    await install.click();
    await page.getByRole("button", { name: en ? "Cancel" : "取消", exact: true }).click();
    assert.equal(
      await page.evaluate(
        () => window.fixture.calls.filter((c) => c.command === "install_app_update").length,
      ),
      0,
    );
    await page.evaluate(() => (window.fixture.fail = true));
    await check.click();
    await page.getByRole("alert").waitFor();
    assert.equal(await install.count(), 0); // Failed recheck cannot install stale metadata.
    await page.evaluate(() => (window.fixture.fail = false));
    await check.click();
    await install.click();
    await page
      .getByRole("button", { name: en ? "Confirm installation" : "确认安装", exact: true })
      .click();
    await page.waitForFunction(() => window.fixture.finish !== null);
    await page.evaluate(() => {
      const f = window.fixture;
      f.callbacks[f.handlers["app://update-progress"]]({
        payload: {
          schemaVersion: 1,
          payload: { downloadedBytes: 1024, totalBytes: 4096, phase: "downloading" },
        },
      });
    });
    await page.getByText("1.0 KB / 4.0 KB", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: en ? "Cancel update download" : "取消更新下载", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    const args = await page.evaluate(
      () => window.fixture.calls.find((c) => c.command === "install_app_update").args,
    );
    assert.deepEqual(args, { version: "0.2.0" });
    for (const [zh, eng, expected] of [
      ["隐私政策", "Privacy policy", en ? "does not automatically upload" : "不会自动上传"],
      ["使用条款", "Terms of use", en ? "authorized" : "授权"],
      ["开源许可证", "Open-source license", "Apache License"],
      ["第三方声明", "Third-party notices", "Savebeam third-party dependency notices"],
    ]) {
      await page.getByRole("button", { name: en ? eng : zh, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByText(expected, { exact: false }).waitFor();
      await page.keyboard.press("Escape");
    }
    await page
      .getByRole("button", { name: en ? "Report an issue" : "报告问题", exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(
        () => window.fixture.calls.find((c) => c.command === "open_app_link").args,
      ),
      { kind: "feedback" },
    );
    // A queued task arriving after a check disables the install button immediately.
    await page.evaluate(() => {
      const f = window.fixture;
      f.callbacks[f.handlers["download://state-changed"]]({
        payload: {
          schemaVersion: 1,
          payload: {
            id: "active",
            title: "queued",
            url: "https://example.com",
            status: "queued",
            format: "best",
            createdAtUnixMs: 1,
          },
        },
      });
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.disabled && /0.2.0/.test(b.textContent),
      ),
    );
    await page.screenshot({ path: `/tmp/savebeam-about-${locale}.png` });
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      `${locale}: explicit check, stale reset, confirmation, progress/cancel, task gate, policies, notices and feedback passed\n`,
    );
  }
} finally {
  await browser.close();
}
