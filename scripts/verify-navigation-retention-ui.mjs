// Local fixtures only: no real files, cookies, subscription checks or downloads.
/* global window, structuredClone */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";

async function navigate(page, label) {
  await page.getByRole("link", { name: label, exact: true }).click();
  await page.getByRole("heading", { level: 1, name: label, exact: true }).waitFor();
}
async function scroll(page, value) {
  return page.locator(".page-content").evaluate(async (element, top) => {
    element.scrollTop = top;
    await new Promise((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
    );
    return element.scrollTop;
  }, value);
}
async function count(page, command) {
  return page.evaluate(
    (name) => window.fixture.calls.filter((call) => call.command === name).length,
    command,
  );
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.isTauri = true;
    window.fixture = {
      calls: [],
      rows: Array.from({ length: 3 }, (_, index) => ({
        id: index + 1,
        url: `https://example.invalid/series-${index}`,
        sourceId: `series-${index}`,
        title: `订阅课程 ${index + 1}`,
        lastCheckedUnixMs: 1,
        truncated: false,
        entries: Array.from({ length: 30 }, (_, entry) => ({
          id: `s${index + 1}-v${entry + 1}`,
          index: entry + 1,
          title: `课程 ${entry + 1}`,
          downloaded: entry === 0,
          isNew: entry > 1,
          available: true,
          taskStatus: null,
        })),
      })),
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.fixture.callbacks = {};
    window.fixture.events = {};
    window.fixture.nextCallback = 0;
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        const id = ++window.fixture.nextCallback;
        window.fixture.callbacks[id] = callback;
        return id;
      },
      unregisterCallback() {},
      async invoke(command, args = {}) {
        const state = window.fixture;
        state.calls.push({ command, args: structuredClone(args) });
        if (command === "plugin:event|listen") {
          state.events[args.event] = args.handler;
          return args.handler;
        }
        if (command === "get_download_history") {
          if (args.query === "迟到查询")
            await new Promise((resolve) => {
              state.releaseHistory = resolve;
            });
          const records = Array.from({ length: 20 }, (_, index) => ({
            taskId: `history-${index}`,
            title: `${args.query || "全部"} 视频 ${index}`,
            outputPaths: [`/fixture/${index}.mp4`],
            totalBytes: 1024,
            completedAtUnixMs: 1,
          }));
          if (args.query === "迟到查询") state.historyReleased = true;
          return records;
        }
        if (command === "delete_download_history")
          throw { code: "permission_denied", message: "fixture deletion failed", retryable: true };
        if (command === "list_subscriptions") return structuredClone(state.rows);
        if (command === "check_subscription") {
          if (state.holdCheck)
            await new Promise((resolve) => {
              state.releaseCheck = resolve;
            });
          state.rows[0].lastCheckedUnixMs = 2;
          return;
        }
        if (command === "get_subscription_candidates") return [];
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
        if (command === "get_cookie_preferences")
          return { cookiesFilePath: null, cookiesBrowser: null, accessConfirmed: false };
        if (command === "get_network_preferences") return { proxyMode: "default", proxyUrl: "" };
        if (command === "inspect_media")
          return {
            id: "series",
            title: "新的系列来源",
            webpageUrl: args.url,
            uploader: "作者",
            durationSeconds: null,
            thumbnailUrl: null,
            thumbnailDataUrl: null,
            formats: [],
            subtitles: [],
            playlist: {
              id: "series",
              title: "新的系列来源",
              downloadCount: 1,
              totalCount: 1,
              truncated: false,
              entries: [
                {
                  id: "new-video",
                  title: "新视频",
                  index: 1,
                  available: true,
                  url: "https://example.invalid/new-video",
                },
              ],
            },
          };
        if (command === "download_subscription_items") {
          for (const entry of state.rows[0].entries)
            if (args.mediaIds.includes(entry.id)) entry.taskStatus = "queued";
          return {
            tasks: args.mediaIds.map((id) => ({
              id,
              title: id,
              url: state.rows[0].url,
              formatId: "best",
              status: "queued",
              createdAtUnixMs: 1,
            })),
            error: null,
          };
        }
        if (command.startsWith("plugin:event|")) return 1;
        return [];
      },
    };
  });
  await page.goto(`${base}#/download`);
  assert.equal(
    await page.locator(".history-page, .subscriptions-page").count(),
    0,
    "No eager loading of retained pages",
  );
  await page
    .getByRole("textbox", { name: "视频链接", exact: true })
    .fill("https://example.invalid/draft");
  await navigate(page, "设置");
  await page.getByRole("tab", { name: "网络与代理", exact: true }).click();
  await navigate(page, "历史");
  const search = page.getByRole("textbox", { name: "搜索标题或文件路径", exact: true });
  await search.fill("筛选");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByText("筛选 视频 19", { exact: true }).waitFor();
  await search.fill("未提交搜索");
  const historyTop = await scroll(page, 600);
  const historyCalls = await count(page, "get_download_history");
  await navigate(page, "订阅");
  const card = page.getByRole("region", { name: "订阅课程 1", exact: true });
  await card.waitFor();
  await page
    .getByRole("textbox", { name: "系列 / 播放列表链接", exact: true })
    .fill("https://example.invalid/unsaved-series");
  await page.getByRole("checkbox", { name: "显示已下载条目", exact: true }).check();
  await card.getByRole("button", { name: /展开条目/ }).click();
  await card.getByRole("checkbox", { name: "第 2 项 · 课程 2", exact: true }).check();
  await card.getByRole("checkbox", { name: "第 3 项 · 课程 3 · 新增", exact: true }).check();
  await card.getByRole("checkbox", { name: "使用代理", exact: true }).check();
  await card.getByRole("button", { name: "高级设置", exact: true }).click();
  let advanced = page.getByRole("dialog", { name: "高级设置", exact: true });
  await advanced.getByRole("checkbox", { name: "保留中间文件", exact: true }).check();
  await advanced.getByRole("button", { name: "应用到本次下载", exact: true }).click();
  const inner = card.getByLabel("订阅课程 1条目", { exact: true });
  await inner.evaluate((element) => {
    element.scrollTop = 140;
  });
  const innerTop = await inner.evaluate((element) => element.scrollTop);
  const subscriptionsTop = await scroll(page, 650);
  const subscriptionCalls = await count(page, "list_subscriptions");
  const candidateCalls = await count(page, "get_subscription_candidates");

  for (const route of ["下载", "任务", "设置", "历史"]) {
    await navigate(page, route);
    assert.equal(
      await page.getByRole("checkbox", { name: "显示已下载条目", exact: true }).count(),
      0,
    );
    await scroll(page, 300);
    if (route === "历史") {
      // Do not overwrite the history page's independent saved position in this test.
      await scroll(page, historyTop);
      assert.equal(await search.inputValue(), "未提交搜索");
      await page.getByText("筛选 视频 19", { exact: true }).waitFor();
    }
    await navigate(page, "订阅");
    assert.equal(
      await page.locator(".page-content").evaluate((element) => element.scrollTop),
      subscriptionsTop,
    );
    assert.equal(await inner.evaluate((element) => element.scrollTop), innerTop);
    assert.equal(
      await page.getByRole("textbox", { name: "系列 / 播放列表链接", exact: true }).inputValue(),
      "https://example.invalid/unsaved-series",
    );
    assert.equal(
      await page.getByRole("checkbox", { name: "显示已下载条目", exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await card.getByRole("checkbox", { name: "第 2 项 · 课程 2", exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await card
        .getByRole("checkbox", { name: "第 3 项 · 课程 3 · 新增", exact: true })
        .isChecked(),
      true,
    );
    assert.equal(
      await card.getByRole("checkbox", { name: "使用代理", exact: true }).isChecked(),
      true,
    );
  }
  assert.equal(await count(page, "list_subscriptions"), subscriptionCalls);
  assert.equal(await count(page, "get_subscription_candidates"), candidateCalls);
  assert.equal(await count(page, "check_subscription"), 0);
  assert.equal(await count(page, "download_subscription_items"), 0);
  assert.equal(await count(page, "get_download_history"), historyCalls);
  await navigate(page, "历史");
  assert.equal(
    await page.locator(".page-content").evaluate((element) => element.scrollTop),
    historyTop,
  );
  assert.equal(await search.inputValue(), "未提交搜索");
  await page.getByRole("button", { name: "删除记录", exact: true }).first().click();
  const deletion = page.getByRole("dialog", { name: "删除下载历史", exact: true });
  await deletion.getByRole("checkbox", { name: "同时删除下载文件", exact: true }).check();
  await deletion.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Meta+4");
  await page.getByRole("heading", { level: 1, name: "订阅", exact: true }).waitFor();
  await deletion.waitFor({ state: "hidden" });
  await navigate(page, "历史");
  await deletion.waitFor();
  assert.equal(
    await deletion.getByRole("checkbox", { name: "同时删除下载文件", exact: true }).isChecked(),
    true,
  );
  await deletion.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await count(page, "delete_download_history"), 0);

  await navigate(page, "订阅");
  await card.getByRole("button", { name: "高级设置", exact: true }).click();
  advanced = page.getByRole("dialog", { name: "高级设置", exact: true });
  assert.equal(
    await advanced.getByRole("checkbox", { name: "保留中间文件", exact: true }).isChecked(),
    true,
  );
  await advanced.getByRole("checkbox", { name: "另存缩略图文件", exact: true }).check();
  await advanced.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Meta+3");
  await page.getByRole("heading", { level: 1, name: "历史", exact: true }).waitFor();
  await advanced.waitFor({ state: "hidden" });
  await navigate(page, "订阅");
  await advanced.waitFor();
  assert.equal(
    await advanced.getByRole("checkbox", { name: "另存缩略图文件", exact: true }).isChecked(),
    true,
  );
  await advanced.getByRole("button", { name: "取消", exact: true }).click();
  await card.getByRole("button", { name: "取消订阅", exact: true }).click();
  const unsubscribe = page.getByRole("dialog", { name: "取消订阅", exact: true });
  await unsubscribe.getByRole("button", { name: "返回", exact: true }).focus();
  await page.keyboard.press("Meta+3");
  await page.getByRole("heading", { level: 1, name: "历史", exact: true }).waitFor();
  await unsubscribe.waitFor({ state: "hidden" });
  await navigate(page, "订阅");
  await unsubscribe.waitFor();
  await unsubscribe.getByRole("button", { name: "返回", exact: true }).click();
  assert.equal(await count(page, "unsubscribe_series"), 0);
  await page.evaluate(() => {
    window.fixture.holdCheck = true;
  });
  await card.getByRole("button", { name: "检查更新", exact: true }).click();
  await navigate(page, "任务");
  await page.evaluate(() => {
    window.fixture.releaseCheck();
  });
  await page.waitForFunction(() => window.fixture.rows[0].lastCheckedUnixMs === 2);
  await navigate(page, "订阅");
  await card.getByRole("button", { name: "下载所选 2 项", exact: true }).waitFor();
  assert.equal(await card.getByRole("button", { name: "检查更新", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "检查全部更新", exact: true }).click();
  await navigate(page, "设置");
  await page.evaluate(() => {
    window.fixture.releaseCheck();
  });
  await navigate(page, "订阅");
  await page.getByRole("status").filter({ hasText: "已检查 1/3 个系列" }).waitFor();
  assert.equal(
    await count(page, "check_subscription"),
    2,
    "Leaving stops the rest of a manual batch, even if the page is retained",
  );

  // A fresh explicit source still prefills the retained subscriptions page, without auto-check.
  await navigate(page, "下载");
  const source = "https://example.invalid/new-series?list=2&part=3#entry";
  await page.getByRole("textbox", { name: "视频链接", exact: true }).fill(source);
  await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
  await page.getByRole("button", { name: "订阅此系列", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "订阅", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "系列 / 播放列表链接", exact: true }).inputValue(),
    source,
  );
  assert.equal(await count(page, "check_subscription"), 2);
  assert.equal(
    await card.getByRole("checkbox", { name: "第 2 项 · 课程 2", exact: true }).isChecked(),
    true,
  );
  await card.getByRole("button", { name: "下载所选 2 项", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已加入 2 个下载任务" }).waitFor();
  const queued = await page.evaluate(
    () => window.fixture.calls.find((call) => call.command === "download_subscription_items").args,
  );
  assert.deepEqual(queued.mediaIds, ["s1-v2", "s1-v3"]);
  assert.equal(queued.useProxy, true);
  assert.equal(queued.downloadOptions.keepIntermediateFiles, true);
  assert.equal(
    queued.downloadOptions.writeThumbnail,
    false,
    "Cancelled modal draft is not applied",
  );
  await page.screenshot({ path: "/tmp/savebeam-subscriptions-retained.png" });
  const beforeResult = await count(page, "get_download_history");
  await page.evaluate(() => {
    const state = window.fixture;
    state.callbacks[state.events["download://result"]]({
      event: "download://result",
      id: 1,
      payload: {
        schemaVersion: 1,
        payload: {
          taskId: "finished",
          title: "新成品",
          outputPaths: ["/fixture/new.mp4"],
          totalBytes: 1024,
        },
      },
    });
  });
  await page.waitForFunction(
    (previous) =>
      window.fixture.calls.filter((call) => call.command === "get_download_history").length >
      previous,
    beforeResult,
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.fixture.calls.filter((call) => call.command === "get_download_history").at(-1).args
          .query,
    ),
    "筛选",
    "A local completion refreshes the submitted filter, not an unsubmitted input",
  );
  await navigate(page, "历史");
  assert.equal(await search.inputValue(), "未提交搜索");
  await page.getByText("筛选 视频 0", { exact: true }).waitFor();
  await search.press("Enter");
  await page.getByText("未提交搜索 视频 0", { exact: true }).waitFor();
  await search.fill("迟到查询");
  await search.press("Enter");
  await navigate(page, "任务");
  await navigate(page, "历史");
  await search.fill("最新查询");
  await search.press("Enter");
  await page.getByText("最新查询 视频 0", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.fixture.releaseHistory();
  });
  await page.waitForFunction(() => window.fixture.historyReleased);
  await page.getByText("最新查询 视频 0", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("迟到查询 视频 0", { exact: true }).count(),
    0,
    "A late query cannot overwrite a newer result",
  );
  assert.deepEqual(errors, []);
  await page.reload();
  assert.equal(
    await page.getByRole("textbox", { name: "搜索标题或文件路径", exact: true }).inputValue(),
    "",
  );
  await navigate(page, "订阅");
  assert.equal(
    await page.getByRole("checkbox", { name: "显示已下载条目", exact: true }).isChecked(),
    false,
  );
  assert.equal(await card.getByRole("button", { name: "下载所选 0 项", exact: true }).count(), 1);
  await page.close();
  process.stdout.write(
    "navigation retention: history search/results, subscription selection/options, outer/inner scroll, hidden modals, async checks, source prefill, queue snapshot and reload boundary passed\n",
  );
} finally {
  await browser.close();
}
