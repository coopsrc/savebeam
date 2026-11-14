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
const labels = ["通用", "下载", "网络与代理", "Cookie 与登录", "运行组件", "关于"];

async function fixture(colorScheme = "light", initialRoute = "settings") {
  const page = await browser.newPage({
    locale: "zh-CN",
    viewport: { width: 1280, height: 800 },
    colorScheme,
  });
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
            audioOnly: true, // Legacy global value must not expose or enable audio-only defaults.
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
        if (command === "get_download_history")
          return Array.from({ length: 20 }, (_, index) => ({
            taskId: `history-${index}`,
            title: `历史视频 ${index}`,
            outputPaths: [`/fixture/history-${index}.mp4`],
            totalBytes: 1024,
            completedAtUnixMs: 1,
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
  await page.goto(`${base}#/${initialRoute}`);
  if (initialRoute === "settings")
    await page.getByRole("tab", { name: "下载", exact: true }).waitFor();
  else await page.getByRole("textbox", { name: "视频链接", exact: true }).waitFor();
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

async function navigate(page, label) {
  await page.getByRole("link", { name: label, exact: true }).click();
  await page.getByRole("heading", { level: 1, name: label, exact: true }).waitFor();
}

async function scrollToBottom(page) {
  return page.locator(".page-content").evaluate(async (element) => {
    element.scrollTop = element.scrollHeight;
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    );
    return element.scrollTop;
  });
}

try {
  const { page, errors } = await fixture();
  assert.equal(
    await page.getByRole("checkbox", { name: "仅下载音频（MP3）", exact: true }).count(),
    0,
  );
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
  await select(page, "通用");
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
  await select(page, "通用");
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
      .getByRole("tab", { name: "通用", exact: true })
      .evaluate((element) => element === window.document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.getByRole("tab", { name: "通用", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  assert.deepEqual(errors, []);
  await page.close();
  process.stdout.write(
    "settings tabs: unsaved drafts, per-tab scroll, sticky bar, hidden controls, async save/error, keyboard and bounded loads passed\n",
  );

  const retained = await fixture("light", "download");
  const workspace = retained.page;
  assert.equal(
    await workspace.locator(".settings-page").count(),
    0,
    "Settings mount only on first visit",
  );
  assert.equal(
    await workspace.evaluate(() =>
      window.settingsFixture.calls.some((call) => call.command === "get_cookie_preferences"),
    ),
    false,
  );
  await workspace
    .getByRole("textbox", { name: "视频链接", exact: true })
    .fill("https://example.invalid/draft");
  await navigate(workspace, "设置");
  const beforeNavigation = await workspace.evaluate(() => window.settingsFixture.calls);
  await workspace
    .getByRole("textbox", { name: "默认下载目录", exact: true })
    .fill("/fixture/retained");
  await workspace.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).check();
  const retainedDownloadScroll = await scrollToBottom(workspace);
  await select(workspace, "Cookie 与登录");
  await choose(workspace, "登录信息来源", "从本机浏览器读取");
  await choose(workspace, "选择浏览器", "Firefox");
  await workspace.getByRole("checkbox", { name: /我授权 Savebeam/ }).check();
  await select(workspace, "网络与代理");
  await choose(workspace, "连接方式", "自定义代理");
  await workspace
    .getByRole("textbox", { name: "代理地址", exact: true })
    .fill("http://127.0.0.1:8888");
  await select(workspace, "运行组件");
  await workspace
    .getByRole("textbox", { name: "自定义可执行文件路径", exact: true })
    .first()
    .fill("/fixture/retained/yt-dlp");
  const retainedComponentsScroll = await scrollToBottom(workspace);
  assert.ok(retainedComponentsScroll > 0);
  await workspace.evaluate(() => {
    window.settingsFixture.root = window.document.querySelector(".settings-page");
  });
  for (const route of ["任务", "历史", "订阅", "下载"]) {
    await navigate(workspace, route);
    assert.equal(
      await workspace.getByRole("tablist", { name: "设置分组", exact: true }).count(),
      0,
    );
    assert.equal(
      await workspace.getByRole("textbox", { name: "自定义可执行文件路径", exact: true }).count(),
      0,
    );
    if (route === "历史")
      assert.ok(
        (await scrollToBottom(workspace)) > retainedComponentsScroll,
        "Scroll a different long page",
      );
    if (route === "下载")
      assert.equal(
        await workspace.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
        "https://example.invalid/draft",
      );
    // Subscriptions legitimately read their own defaults on entry; settings return must not.
    const defaultsBeforeReturn = await workspace.evaluate(
      () =>
        window.settingsFixture.calls.filter(
          (call) => call.command === "get_download_option_defaults",
        ).length,
    );
    await navigate(workspace, "设置");
    assert.equal(
      await workspace.evaluate(
        () =>
          window.settingsFixture.calls.filter(
            (call) => call.command === "get_download_option_defaults",
          ).length,
      ),
      defaultsBeforeReturn,
    );
    assert.equal(
      await workspace
        .getByRole("tab", { name: "运行组件", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await workspace.locator(".page-content").evaluate((element) => element.scrollTop),
      retainedComponentsScroll,
    );
    assert.equal(
      await workspace.evaluate(
        () => window.settingsFixture.root === window.document.querySelector(".settings-page"),
      ),
      true,
      "Keep the same settings instance",
    );
  }
  await workspace.locator(".dev-platform-switcher").getByText("macOS", { exact: true }).click();
  await workspace.getByRole("tab", { name: "运行组件", exact: true }).focus();
  await workspace.keyboard.press("Meta+2");
  await workspace.getByRole("heading", { level: 1, name: "任务", exact: true }).waitFor();
  await workspace.keyboard.press("Meta+,");
  await workspace.getByRole("heading", { level: 1, name: "设置", exact: true }).waitFor();
  assert.equal(
    await workspace
      .getByRole("tab", { name: "运行组件", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await workspace.locator(".page-content").evaluate((element) => element.scrollTop),
    retainedComponentsScroll,
  );
  await select(workspace, "下载");
  assert.equal(
    await workspace.locator(".page-content").evaluate((element) => element.scrollTop),
    retainedDownloadScroll,
  );
  assert.equal(
    await workspace.getByRole("textbox", { name: "默认下载目录", exact: true }).inputValue(),
    "/fixture/retained",
  );
  assert.equal(
    await workspace.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).isChecked(),
    true,
  );
  // Sidebar clicks close a portaled selector rather than leaving it over another page.
  await workspace.getByRole("combobox", { name: "下载字幕", exact: true }).click();
  await workspace.getByRole("option").first().waitFor();
  await navigate(workspace, "任务");
  assert.equal(await workspace.getByRole("option").count(), 0);
  await navigate(workspace, "设置");
  await select(workspace, "Cookie 与登录");
  assert.equal(
    await workspace.getByRole("combobox", { name: "选择浏览器", exact: true }).inputValue(),
    "Firefox",
  );
  assert.equal(
    await workspace.getByRole("checkbox", { name: /我授权 Savebeam/ }).isChecked(),
    true,
  );
  await select(workspace, "网络与代理");
  assert.equal(
    await workspace.getByRole("textbox", { name: "代理地址", exact: true }).inputValue(),
    "http://127.0.0.1:8888",
  );
  await workspace.evaluate(() => {
    window.settingsFixture.failNetwork = true;
  });
  await workspace.getByRole("button", { name: "保存网络设置", exact: true }).click();
  await navigate(workspace, "历史");
  await workspace.getByText("网络保存失败测试", { exact: true }).waitFor({ state: "attached" });
  await navigate(workspace, "设置");
  await workspace.getByRole("alert").filter({ hasText: "网络保存失败测试" }).waitFor();
  await workspace.evaluate(() => {
    window.settingsFixture.failNetwork = false;
  });
  await workspace.getByRole("button", { name: "保存网络设置", exact: true }).click();
  await navigate(workspace, "任务");
  await workspace.getByText("网络设置已保存。", { exact: true }).waitFor({ state: "attached" });
  await navigate(workspace, "设置");
  await workspace.getByRole("status").filter({ hasText: "网络设置已保存。" }).waitFor();
  const afterNavigation = await workspace.evaluate(() => window.settingsFixture.calls);
  for (const command of [
    "get_download_preferences",
    "get_cookie_preferences",
    "get_network_preferences",
    "get_component_status",
    "get_component_releases",
  ])
    assert.equal(
      afterNavigation.filter((call) => call.command === command).length,
      beforeNavigation.filter((call) => call.command === command).length,
      `Sidebar return must not repeat ${command}`,
    );
  assert.equal(
    afterNavigation.filter((call) => call.command.startsWith("save_")).length,
    2,
    "Only explicit save clicks write configuration",
  );
  assert.deepEqual(retained.errors, []);
  await workspace.screenshot({ path: "/tmp/savebeam-settings-retained.png" });
  await workspace.reload();
  await workspace.getByRole("tab", { name: "下载", exact: true }).waitFor();
  assert.equal(
    await workspace.getByRole("tab", { name: "下载", exact: true }).getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await workspace.getByRole("textbox", { name: "默认下载目录", exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await workspace.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).isChecked(),
    false,
    "Reload reads saved defaults, not unsaved settings",
  );
  await workspace.close();
  process.stdout.write(
    "settings session: all sidebar routes, unchanged instance, active tab, per-tab scroll, isolated history scrolling, unsaved inputs, hidden dropdowns and async save/error passed\n",
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
        assert.equal(await tabs.getByRole("tab").count(), labels.length);
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
