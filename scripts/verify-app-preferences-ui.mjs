// Isolated browser storage and IPC fixtures only; no actual app data or network requests.
/* global window, localStorage, document, Storage */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
const key = "savebeam.ui-preferences.v1";
async function fixture(locale, raw) {
  const page = await browser.newPage({
    locale,
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, raw }) => {
      if (raw !== undefined && !localStorage.getItem("fixture-initialized")) {
        localStorage.setItem(key, raw);
        localStorage.setItem("fixture-initialized", "true");
      }
      window.isTauri = true;
      window.fixtureCalls = [];
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          window.fixtureCalls.push({ command, args });
          if (command === "plugin:dialog|message")
            return window.fixtureConfirm ? "Continue" : "Cancel";
          if (command === "plugin:dialog|save") return "/fixture/diagnostics.json";
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
          if (command === "get_download_preferences")
            return { outputDirectory: "", maxConcurrent: 1, conflictStrategy: "skip" };
          if (command === "get_network_preferences") return { proxyMode: "default", proxyUrl: "" };
          if (command === "get_cookie_preferences")
            return { cookiesFilePath: null, cookiesBrowser: null, accessConfirmed: false };
          if (command === "get_component_status") return [];
          if (
            command === "get_download_tasks" ||
            command === "get_download_history" ||
            command === "list_subscriptions" ||
            command === "get_subscription_candidates"
          )
            return [];
          return null;
        },
      };
    },
    { key, raw },
  );
  await page.goto(base + "#/download");
  return { page, errors };
}
async function choose(page, label, value) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
try {
  const { page, errors } = await fixture("zh-CN");
  await page
    .getByRole("textbox", { name: "视频链接", exact: true })
    .fill("https://example.invalid/video/中文标题");
  await page.getByRole("link", { name: "设置", exact: true }).click();
  // Existing settings drafts survive theme/language switches without remounting panels.
  await page.getByRole("textbox", { name: "默认下载目录", exact: true }).fill("/fixture/中文目录");
  await page.getByRole("tab", { name: "通用", exact: true }).click();
  assert.equal(await page.getByRole("tab", { name: "隐私与诊断", exact: true }).count(), 0);
  await page.getByRole("button", { name: "导出诊断信息", exact: true }).waitFor();
  await page.getByRole("button", { name: "导出诊断信息", exact: true }).click();
  assert.equal(
    await page.evaluate(() =>
      window.fixtureCalls.some((call) => call.command === "export_diagnostics"),
    ),
    false,
  );
  await choose(page, "主题", "暗色");
  assert.equal(await page.locator("html").getAttribute("data-mantine-color-scheme"), "dark");
  await choose(page, "界面语言", "English");
  assert.equal(await page.locator("html").getAttribute("lang"), "en-US");
  await page.getByRole("tab", { name: "General", exact: true }).waitFor();
  await choose(page, "Theme", "Light");
  assert.equal(await page.locator("html").getAttribute("data-mantine-color-scheme"), "light");
  await choose(page, "Theme", "System");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.mantineColorScheme === "dark");
  await choose(page, "Theme", "Dark");
  await page.getByRole("link", { name: "Download", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Video URL", exact: true }).inputValue(),
    "https://example.invalid/video/中文标题",
  );
  for (const route of ["Tasks", "History", "Subscriptions"]) {
    await page.getByRole("link", { name: route, exact: true }).click();
    await page.locator(".toolbar-title").filter({ hasText: route }).waitFor();
    assert.equal(
      /[\u3400-\u9fff]/.test(await page.locator("body").innerText()),
      false,
      `${route} empty state is fully localized`,
    );
  }
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByRole("tab", { name: "General", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("tab", { name: "Download", exact: true }).click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Default download directory", exact: true })
      .inputValue(),
    "/fixture/中文目录",
  );
  await page.getByRole("tab", { name: "Network & Proxy", exact: true }).click();
  await page.getByRole("combobox", { name: "Connection mode", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Components", exact: true }).click();
  await page.getByRole("button", { name: "Check component updates", exact: true }).waitFor();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  await page.evaluate(() => {
    window.fixtureConfirm = true;
  });
  await page.getByRole("button", { name: "Export diagnostics", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Diagnostics saved to the selected location." })
    .waitFor();
  assert.deepEqual(
    await page.evaluate(() =>
      window.fixtureCalls
        .filter((call) => call.command === "export_diagnostics")
        .map((call) => call.args),
    ),
    [{ destination: "/fixture/diagnostics.json" }],
  );
  await page.screenshot({ path: "/tmp/savebeam-general-english-dark.png" });
  assert.deepEqual(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key), {
    theme: "dark",
    language: "en-US",
  });
  await page.reload();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "General", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-mantine-color-scheme"), "dark");
  assert.equal(
    await page.getByRole("combobox", { name: "Interface language", exact: true }).inputValue(),
    "English",
  );
  await choose(page, "Interface language", "简体中文");
  await page.getByRole("tab", { name: "通用", exact: true }).waitFor();
  // Storage write failures never pretend that a preference was saved/applied.
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new Error("fixture storage failure");
    };
  });
  await choose(page, "主题", "亮色");
  await page.getByRole("alert").filter({ hasText: "无法保存界面偏好" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("data-mantine-color-scheme"), "dark");
  assert.deepEqual(errors, []);
  await page.close();
  for (const [locale, raw, lang] of [
    ["en-US", undefined, "en-US"],
    ["zh-TW", undefined, "zh-CN"],
    ["ja-JP", undefined, "en-US"],
    ["en-US", "bad", "en-US"],
  ]) {
    const { page, errors } = await fixture(locale, raw);
    assert.equal(await page.locator("html").getAttribute("lang"), lang);
    if (locale === "en-US" && raw === undefined) {
      await page.evaluate(() => {
        Object.defineProperty(window.navigator, "languages", {
          configurable: true,
          value: ["zh-CN"],
        });
        window.dispatchEvent(new window.Event("languagechange"));
      });
      await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
    }
    if (raw) {
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page.getByRole("tab", { name: "General", exact: true }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Could not read interface preferences" })
        .waitFor();
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  process.stdout.write(
    "UI preferences: instant theme/locale, system following, persistence, draft retention, storage failure and fallback passed\n",
  );
} finally {
  await browser.close();
}
