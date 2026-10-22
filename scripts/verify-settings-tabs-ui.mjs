// Local IPC fixtures only: no real preferences, cookies, downloads or network changes.
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
const labels = ["下载", "网络与代理", "Cookie 与登录", "运行组件", "隐私与诊断"];

async function fixture(colorScheme = "light") {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.isTauri = true;
    window.settingsFixture = { calls: [], failNetwork: false };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback() {
        return 1;
      },
      unregisterCallback() {},
      async invoke(command, args = {}) {
        const state = window.settingsFixture;
        state.calls.push({ command, args });
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
        if (command === "get_network_preferences") return { proxyMode: "default", proxyUrl: "" };
        if (command === "get_component_status")
          return ["yt_dlp", "ffmpeg", "ffprobe", "javascript_runtime"].map((kind) => ({
            kind,
            status: "available",
            source: "system",
            executablePath: `/fixture/bin/${kind}`,
            version: "fixture",
          }));
        if (command === "save_network_preferences") {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          if (state.failNetwork)
            throw { code: "unknown", message: "网络保存失败测试", retryable: true };
          return args.preferences;
        }
        if (command === "save_download_option_defaults") return args.options;
        if (command === "save_download_preferences" || command === "save_cookie_preferences")
          return args.preferences;
        if (command.startsWith("plugin:event|")) return 1;
        return [];
      },
    };
  });
  await page.goto(`${base}#/settings`);
  await page.getByRole("tab", { name: "下载", exact: true }).waitFor();
  return { page, errors };
}

async function select(page, label) {
  await page.getByRole("tab", { name: label, exact: true }).click();
  await page.getByRole("tabpanel", { name: label, exact: true }).waitFor();
}

async function choose(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

try {
  const { page, errors } = await fixture();
  await page.getByRole("textbox", { name: "默认下载目录", exact: true }).fill("/fixture/draft");
  await page.getByRole("checkbox", { name: "保留中间文件", exact: true }).check();
  const initialCalls = await page.evaluate(() => window.settingsFixture.calls);
  const viewport = page.locator(".page-content");
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const downloadScroll = await viewport.evaluate((element) => element.scrollTop);
  assert.ok(downloadScroll > 0);
  const toolbar = await page.locator(".settings-tab-bar").boundingBox();
  const viewportBox = await viewport.boundingBox();
  assert.ok(Math.abs(toolbar.y - viewportBox.y) <= 1, "Tabs remain sticky while scrolling");
  await select(page, "网络与代理");
  assert.equal(await viewport.evaluate((element) => element.scrollTop), 0);
  await choose(page, "连接方式", "自定义代理");
  await page.getByRole("textbox", { name: "代理地址", exact: true }).fill("http://127.0.0.1:7890");
  await select(page, "Cookie 与登录");
  await choose(page, "登录信息来源", "从本机浏览器读取");
  await choose(page, "选择浏览器", "Google Chrome");
  await page.getByRole("checkbox", { name: /我授权 Savebeam/ }).check();
  await select(page, "运行组件");
  await page
    .getByRole("textbox", { name: "自定义可执行文件路径", exact: true })
    .first()
    .fill("/fixture/custom/yt-dlp");
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const componentsScroll = await viewport.evaluate((element) => element.scrollTop);
  await select(page, "隐私与诊断");
  assert.equal(await page.getByRole("textbox").count(), 0, "Hidden inputs are not accessible");
  await select(page, "下载");
  assert.equal(await viewport.evaluate((element) => element.scrollTop), downloadScroll);
  assert.equal(
    await page.getByRole("textbox", { name: "默认下载目录", exact: true }).inputValue(),
    "/fixture/draft",
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "保留中间文件", exact: true }).isChecked(),
    true,
  );
  await select(page, "Cookie 与登录");
  assert.equal(
    await page.getByRole("combobox", { name: "选择浏览器", exact: true }).inputValue(),
    "Google Chrome",
  );
  assert.equal(await page.getByRole("checkbox", { name: /我授权 Savebeam/ }).isChecked(), true);
  await select(page, "运行组件");
  assert.equal(await viewport.evaluate((element) => element.scrollTop), componentsScroll);
  assert.equal(
    await page
      .getByRole("textbox", { name: "自定义可执行文件路径", exact: true })
      .first()
      .inputValue(),
    "/fixture/custom/yt-dlp",
  );

  // Save failure and completion both survive tab switching without repeated IPC loads.
  await select(page, "网络与代理");
  assert.equal(
    await page.getByRole("textbox", { name: "代理地址", exact: true }).inputValue(),
    "http://127.0.0.1:7890",
  );
  await page.evaluate(() => {
    window.settingsFixture.failNetwork = true;
  });
  await page.getByRole("button", { name: "保存网络设置", exact: true }).click();
  await select(page, "下载");
  await page
    .locator('[role="tabpanel"]')
    .filter({ has: page.getByText("网络保存失败测试", { exact: true }) })
    .waitFor({ state: "attached" });
  await select(page, "网络与代理");
  await page.getByRole("alert").filter({ hasText: "网络保存失败测试" }).waitFor();
  await page.evaluate(() => {
    window.settingsFixture.failNetwork = false;
  });
  await page.getByRole("button", { name: "保存网络设置", exact: true }).click();
  await select(page, "隐私与诊断");
  await page.getByText("网络设置已保存。", { exact: true }).waitFor({ state: "attached" });
  await select(page, "网络与代理");
  await page.getByRole("status").filter({ hasText: "网络设置已保存。" }).waitFor();
  const calls = await page.evaluate(() => window.settingsFixture.calls);
  for (const command of [
    "get_download_preferences",
    "get_download_option_defaults",
    "get_cookie_preferences",
    "get_network_preferences",
    "get_component_status",
    "get_component_releases",
  ])
    assert.equal(
      calls.filter((call) => call.command === command).length,
      initialCalls.filter((call) => call.command === command).length,
      `${command} is not repeated on tab switches`,
    );
  assert.equal(
    calls.filter((call) => call.command.startsWith("save_")).length,
    2,
    "Tab changes never implicitly save",
  );
  await page.getByRole("tab", { name: "网络与代理", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Cookie 与登录", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Home");
  assert.equal(
    await page
      .getByRole("tab", { name: "下载", exact: true })
      .evaluate((element) => element === window.document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.getByRole("tab", { name: "下载", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual(errors, []);
  await page.close();
  process.stdout.write(
    "settings tabs: unsaved drafts, per-tab scroll, sticky bar, hidden controls, async save/error, keyboard and bounded loads passed\n",
  );

  for (const scheme of ["light", "dark"]) {
    const scene = await fixture(scheme);
    for (const platform of ["macOS", "Windows", "Linux"]) {
      await scene.page
        .locator(".dev-platform-switcher")
        .getByText(platform, { exact: true })
        .click();
      for (const label of labels) {
        await select(scene.page, label);
        const selectedStyle = await scene.page
          .getByRole("tab", { name: label, exact: true })
          .evaluate((element) => {
            const style = window.getComputedStyle(element);
            const expected = window.document.createElement("span");
            expected.style.backgroundColor = "var(--sb-color-accent)";
            element.append(expected);
            const accent = window.getComputedStyle(expected).backgroundColor;
            expected.remove();
            return {
              background: style.backgroundColor,
              accent,
              color: style.color,
              border: style.borderBottomWidth,
            };
          });
        assert.equal(
          selectedStyle.background,
          selectedStyle.accent,
          "Selected tab stays accent-filled even under hover",
        );
        assert.equal(selectedStyle.color, "rgb(255, 255, 255)");
        assert.equal(selectedStyle.border, "0px", "No leftover underline from default tabs");
        const tabs = scene.page.getByRole("tablist", { name: "设置分组", exact: true });
        assert.equal(await tabs.getByRole("tab").count(), 5);
        assert.equal(await scene.page.getByRole("tabpanel").count(), 1);
        const box = await tabs.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= 1280, "All tabs fit minimum desktop width");
        assert.equal(
          await scene.page.evaluate(
            () => window.document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
        );
        await scene.page.screenshot({
          path: `/tmp/savebeam-settings-${platform}-${scheme}-${labels.indexOf(label)}.png`,
        });
      }
    }
    for (const width of [800, 560]) {
      await scene.page.setViewportSize({ width, height: 800 });
      for (const label of labels) {
        await select(scene.page, label);
        assert.equal(
          await scene.page.evaluate(
            () => window.document.documentElement.scrollWidth <= window.innerWidth,
          ),
          true,
          `Narrow preview stays within the viewport at ${width}px`,
        );
      }
    }
    assert.deepEqual(scene.errors, []);
    await scene.page.close();
    process.stdout.write(
      `settings tabs: 3 desktop profiles × 5 groups (${scheme}) at 1280x800 passed\n`,
    );
  }
} finally {
  await browser.close();
}
