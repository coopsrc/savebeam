// Fixture-only browser regression; no live site requests, downloads, or cookies.
/* global window, structuredClone */
// node scripts/verify-subscriptions-ui.mjs /absolute/path/to/playwright/index.mjs [baseURL]
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Pass the installed Playwright module path.");
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const fixture = {
  id: 1,
  url: "https://example.invalid/series",
  sourceId: "fixture:list",
  title: "持续更新的课程",
  lastCheckedUnixMs: 1700000000000,
  truncated: false,
  entries: [
    {
      id: "old",
      index: 1,
      title: "已下载课程",
      downloaded: true,
      isNew: false,
      available: true,
      taskStatus: null,
    },
    {
      id: "missed",
      index: 2,
      title: "以前未下载",
      downloaded: false,
      isNew: false,
      available: true,
      taskStatus: null,
    },
    {
      id: "v72",
      index: 72,
      title: "新增课程",
      downloaded: false,
      isNew: true,
      available: true,
      taskStatus: null,
    },
    {
      id: "failed",
      index: 73,
      title: "失败可重试",
      downloaded: false,
      isNew: true,
      available: true,
      taskStatus: "failed",
    },
    {
      id: "unavailable",
      index: 74,
      title: "不可用",
      downloaded: false,
      isNew: true,
      available: false,
      taskStatus: null,
    },
  ],
};
try {
  for (const scenario of ["selection", "failed-check", "truncated", "add", "remove"]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ fixture, scenario }) => {
        window.isTauri = true;
        window.calls = [];
        window.rows = scenario === "add" ? [] : [fixture];
        if (scenario === "truncated") fixture.truncated = true;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        window.__TAURI_INTERNALS__ = {
          transformCallback() {
            return 1;
          },
          unregisterCallback() {},
          async invoke(command, args = {}) {
            window.calls.push({ command, args });
            if (command === "list_subscriptions") return structuredClone(window.rows);
            if (command === "get_subscription_candidates")
              return [{ url: fixture.url, title: fixture.title }];
            if (command === "subscribe_series") {
              window.rows = [fixture];
              return 1;
            }
            if (command === "unsubscribe_series") {
              window.rows = [];
              return;
            }
            if (command === "check_subscription" && scenario === "failed-check")
              throw {
                code: "network_failure",
                message: "测试网络失败，保留上次结果",
                retryable: true,
              };
            if (command === "download_subscription_items") {
              for (const entry of fixture.entries)
                if (args.mediaIds.includes(entry.id)) entry.taskStatus = "queued";
              return {
                tasks: args.mediaIds.map((id) => ({
                  id: `task-${id}`,
                  url: fixture.url,
                  title: id,
                  formatId: "bestvideo+bestaudio/best",
                  status: "queued",
                  createdAtUnixMs: 1000,
                })),
                error: null,
              };
            }
            if (command.startsWith("plugin:event|")) return 1;
            return [];
          },
        };
      },
      { fixture: structuredClone(fixture), scenario },
    );
    await page.goto(
      `${base}#/subscriptions${scenario === "add" ? `?url=${encodeURIComponent(fixture.url)}` : ""}`,
    );
    await page.getByRole("heading", { name: "系列订阅", exact: true }).waitFor();
    await page.getByRole("button", { name: "添加订阅并检查", exact: true }).waitFor();
    if (scenario === "add") {
      assert.equal(
        await page.getByRole("textbox", { name: "系列 / 播放列表链接" }).inputValue(),
        fixture.url,
      );
      await page.getByRole("button", { name: "添加订阅并检查", exact: true }).click();
      await page.getByRole("region", { name: fixture.title, exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter((call) => call.command === "download_subscription_items").length,
        ),
        0,
      );
    } else {
      const card = page.getByRole("region", { name: fixture.title, exact: true });
      await card.waitFor();
      if (scenario === "selection") {
        await card.getByRole("button", { name: "选择新增", exact: true }).click();
        await card.getByRole("button", { name: /展开条目/ }).click();
        assert.equal(
          await card
            .getByRole("checkbox", { name: "第 72 项 · 新增课程 · 新增", exact: true })
            .isChecked(),
          true,
        );
        assert.equal(
          await card
            .getByRole("checkbox", { name: "第 2 项 · 以前未下载", exact: true })
            .isChecked(),
          false,
        );
        await card
          .getByRole("checkbox", { name: "第 73 项 · 失败可重试 · 新增", exact: true })
          .uncheck();
        await card.getByRole("button", { name: "下载所选 1 项", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "已加入 1 个下载任务" }).waitFor();
        const calls = await page.evaluate(() =>
          window.calls.filter((call) => call.command === "download_subscription_items"),
        );
        assert.deepEqual(calls[0].args, { id: 1, mediaIds: ["v72"] });
        assert.equal(
          await card
            .getByRole("checkbox", { name: "第 72 项 · 新增课程 · 新增", exact: true })
            .isDisabled(),
          true,
        );
        await page.getByRole("checkbox", { name: "显示已下载条目", exact: true }).check();
        assert.equal(
          await card
            .getByRole("checkbox", { name: "第 1 项 · 已下载课程", exact: true })
            .isDisabled(),
          true,
        );
        await page.screenshot({ path: "/tmp/savebeam-subscriptions-ui.png", fullPage: true });
      }
      if (scenario === "failed-check") {
        await card.getByRole("button", { name: "检查更新", exact: true }).click();
        await card.getByRole("alert").filter({ hasText: "测试网络失败" }).waitFor();
        await card.getByText("新增 2", { exact: true }).waitFor();
        await card.getByText(/本次检查失败，保留上次结果/).waitFor();
      }
      if (scenario === "truncated")
        await card.getByRole("alert").filter({ hasText: "不代表整个系列没有更新" }).waitFor();
      if (scenario === "remove") {
        await card.getByRole("button", { name: "取消订阅", exact: true }).click();
        const modal = page.getByRole("dialog", { name: "取消订阅" });
        await modal.getByText(/不删除下载文件/).waitFor();
        await modal.getByRole("button", { name: "确认取消订阅", exact: true }).click();
        await card.waitFor({ state: "detached" });
        assert.equal(
          await page.evaluate(() =>
            window.calls.some((call) => /delete_download|open_history/.test(call.command)),
          ),
          false,
        );
      }
    }
    assert.deepEqual(errors, []);
    await page.getByRole("link", { name: "订阅", exact: true }).waitFor();
    process.stdout.write(`${scenario}: passed\n`);
    await page.close();
  }
} finally {
  await browser.close();
}
