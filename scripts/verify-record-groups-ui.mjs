// Display-only grouping with isolated IPC fixtures; never touches app data or downloads.
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
  for (const locale of ["zh-CN", "en-US"]) {
    const page = await browser.newPage({
      locale,
      viewport: { width: 1280, height: 800 },
      colorScheme: locale === "en-US" ? "dark" : "light",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.isTauri = true;
      const group = (key, title, index, kind = "collection") => ({
        key,
        title,
        itemIndex: index,
        partIndex: null,
        kind,
        sourceUrl: `https://example.invalid/${key}`,
      });
      const task = (id, title, status, context, time = 1) => ({
        id,
        title,
        status,
        group: context,
        createdAtUnixMs: time,
        url: "https://example.invalid/source",
        formatId: "v+a",
      });
      const a1 = task("a1", "子视频一", "completed", group("A", "合并测试合集", 1));
      const a2 = task("a2", "子视频二失败", "failed", group("A", "合并测试合集", 2));
      const tasks = [
        a1,
        a2,
        task("b1", "另一个合集的子项", "completed", group("B", "另一个合集", 1)),
        task("single", "普通单视频", "completed", null),
        ...Array.from({ length: 20 }, (_, i) =>
          task(`p${i + 1}`, `分P ${i + 1}`, "queued", group("P", "独立多P", i + 1, "multipart")),
        ),
      ];
      const record = (t) => ({
        taskId: t.id,
        title: t.title,
        group: t.group,
        outputPaths: [`/fixture/${t.id}.mp4`],
        totalBytes: 1024,
        completedAtUnixMs: t.createdAtUnixMs,
      });
      const history = [
        record(a1),
        record({ ...a1, id: "a1-old", title: "子视频一旧版本" }),
        record(tasks[2]),
        record(tasks[3]),
      ];
      window.groupFixture = { tasks, history, calls: [], callbacks: {}, handlers: {}, counter: 0 };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback(cb) {
          const id = ++window.groupFixture.counter;
          window.groupFixture.callbacks[id] = cb;
          return id;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          const f = window.groupFixture;
          f.calls.push({ command, args });
          if (command === "plugin:event|listen") {
            f.handlers[args.event] = args.handler;
            return 1;
          }
          if (command === "get_download_tasks") return f.tasks;
          if (command === "get_download_history")
            return f.history.filter(
              (r) =>
                !args.query ||
                r.title.includes(args.query) ||
                r.group?.title.includes(args.query) ||
                r.outputPaths.some((p) => p.includes(args.query)),
            );
          if (command === "get_download_history_record")
            return f.history.find((r) => r.taskId === args.taskId) ?? null;
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
          if (command === "list_media_versions") return [];
          if (command === "delete_download_task") {
            f.tasks = f.tasks.filter((t) => t.id !== args.taskId);
            return true;
          }
          if (command === "delete_download_history") {
            f.history = f.history.filter((r) => r.taskId !== args.taskId);
            return true;
          }
          return null;
        },
      };
      window.addBatch = () => {
        const f = window.groupFixture;
        const added = task(
          "a3",
          "子视频搜索命中",
          "completed",
          {
            ...group("A", "合并测试合集", 3),
            sourceUrl: "https://example.invalid/A?utm_source=update",
          },
          99,
        );
        f.tasks.push(added);
        f.history.push(record(added));
        f.callbacks[f.handlers["download://state-changed"]]({
          payload: { schemaVersion: 1, payload: added },
        });
        f.callbacks[f.handlers["download://result"]]({
          payload: {
            schemaVersion: 1,
            payload: {
              taskId: added.id,
              title: added.title,
              outputPaths: ["/fixture/a3.mp4"],
              totalBytes: 1024,
            },
          },
        });
      };
    });
    const en = locale === "en-US",
      route = (zh, eng) => page.getByRole("link", { name: en ? eng : zh, exact: true });
    await page.goto(base + "#/tasks");
    const groups = page.locator(".task-list-page:not(.history-page) .record-group");
    await groups.first().waitFor();
    assert.equal(await groups.count(), 3);
    const a = groups.filter({ has: page.getByText("合并测试合集", { exact: true }) });
    const p = groups.filter({ has: page.getByText("独立多P", { exact: true }) });
    assert.equal(
      await a.getByRole("button", { name: en ? "Delete task" : "删除任务", exact: true }).count(),
      0,
    );
    assert.deepEqual(
      await page.evaluate(() => [
        ...new Set(
          window.groupFixture.calls
            .filter((c) => c.command === "get_download_history_record")
            .map((c) => c.args.taskId),
        ),
      ]),
      ["single"],
      "collapsed completed children do not load history",
    );
    const progress = a.getByRole("progressbar");
    assert.equal(await progress.getAttribute("aria-valuenow"), "50");
    await a
      .getByRole("button", {
        name: en ? "Expand group: 合并测试合集" : "展开分组：合并测试合集",
        exact: true,
      })
      .click();
    await a.getByText("子视频二失败", { exact: true }).waitFor();
    await page.evaluate(() => window.addBatch());
    await a.getByText("子视频搜索命中", { exact: true }).waitFor();
    assert.equal(await groups.count(), 3);
    assert.equal(await progress.getAttribute("aria-valuenow"), "67");
    await page.screenshot({ path: `/tmp/savebeam-task-groups-${locale}.png` });
    await a
      .getByRole("button", {
        name: en ? "Collapse group: 合并测试合集" : "收起分组：合并测试合集",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", {
        name: en ? "Expand group: 独立多P" : "展开分组：独立多P",
        exact: true,
      })
      .click();
    const list = p.locator(".record-group-list");
    await list.evaluate((e) => {
      e.scrollTop = 220;
    });
    const scroll = await list.evaluate((e) => e.scrollTop);
    assert.ok(scroll > 0);
    await page.waitForTimeout(100);
    await route("历史", "History").click();
    await page.locator(".history-page").waitFor({ state: "visible" });
    await route("任务", "Tasks").click();
    await p.waitFor({ state: "visible" });
    assert.equal(await list.evaluate((e) => e.scrollTop), scroll);
    assert.equal(
      await a
        .getByRole("button", {
          name: en ? "Expand group: 合并测试合集" : "展开分组：合并测试合集",
          exact: true,
        })
        .getAttribute("aria-expanded"),
      "false",
    );
    await a
      .getByRole("button", {
        name: en ? "Expand group: 合并测试合集" : "展开分组：合并测试合集",
        exact: true,
      })
      .click();
    await a
      .getByRole("region", { name: en ? "Task: 子视频二失败" : "任务：子视频二失败", exact: true })
      .getByRole("button", { name: en ? "Delete task" : "删除任务", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: en ? "Delete task" : "删除任务", exact: true });
    await modal.waitFor({ state: "visible" });
    await page.evaluate(() => {
      window.location.hash = "#/history";
    });
    await modal.waitFor({ state: "hidden" });
    await page.evaluate(() => {
      window.location.hash = "#/tasks";
    });
    await modal.waitFor({ state: "visible" });
    await modal
      .getByRole("button", { name: en ? "Confirm task deletion" : "确认删除任务", exact: true })
      .click();
    assert.equal(await a.getByText("子视频二失败", { exact: true }).count(), 0);
    assert.equal(await progress.getAttribute("aria-valuenow"), "100");
    await route("历史", "History").click();
    const historyGroup = page
      .locator(".history-page .record-group")
      .filter({ has: page.getByText("合并测试合集", { exact: true }) });
    await historyGroup.waitFor();
    assert.equal(await page.locator(".history-page .record-group").count(), 2);
    await historyGroup
      .getByRole("button", {
        name: en ? "Expand group: 合并测试合集" : "展开分组：合并测试合集",
        exact: true,
      })
      .click();
    assert.equal(
      await historyGroup
        .getByRole("button", { name: en ? "Delete record" : "删除记录", exact: true })
        .count(),
      3,
      "all batches and old versions remain distinct children",
    );
    const search = page.getByRole("textbox", {
      name: en ? "Search title or file path" : "搜索标题或文件路径",
      exact: true,
    });
    await search.fill("子视频搜索命中");
    await search.press("Enter");
    await historyGroup
      .getByText(en ? "1 records in current results" : "当前结果 1 条记录", { exact: false })
      .waitFor();
    assert.equal(
      await historyGroup
        .getByRole("button", { name: en ? "Delete record" : "删除记录", exact: true })
        .count(),
      1,
    );
    await historyGroup
      .getByRole("button", { name: en ? "Open file" : "打开文件", exact: true })
      .click();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.groupFixture.calls.filter((c) => c.command === "open_history_file").at(-1).args,
      ),
      { taskId: "a3", outputIndex: 0 },
    );
    await historyGroup
      .getByRole("button", { name: en ? "Delete record" : "删除记录", exact: true })
      .click();
    const deletion = page.getByRole("dialog", {
      name: en ? "Delete download history" : "删除下载历史",
      exact: true,
    });
    assert.equal(await deletion.getByRole("checkbox").isChecked(), false);
    await deletion
      .getByRole("button", { name: en ? "Delete record only" : "仅删除记录", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: en ? "History deleted" : "历史记录已删除" })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.groupFixture.calls.filter((c) => c.command === "delete_download_history").at(-1)
            .args,
      ),
      { taskId: "a3", deleteFiles: false },
    );
    await search.fill("");
    await search.press("Enter");
    await historyGroup.getByText("子视频一旧版本", { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/savebeam-record-groups-${locale}.png` });
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      `${locale}: collapsed groups, live update merge, independent actions, versions, search and retained scroll passed\n`,
    );
  }
} finally {
  await browser.close();
}
