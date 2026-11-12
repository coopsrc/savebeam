// Isolated IPC fixtures; no app database, real files or media downloads.
/* global window, document */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
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
      const group = (key, title, index, kind = "collection") => ({
        key,
        title,
        itemIndex: index,
        partIndex: null,
        kind,
        sourceUrl: "https://example.invalid/" + key,
      });
      const task = (id, title, status, context, time = 1) => ({
        id,
        title,
        status,
        batchId: "first-round",
        group: context,
        createdAtUnixMs: time,
        url: "https://example.invalid/" + id,
        formatId: "v+a",
        formatDetails: {
          outputExtension: "mp4",
          audioOnly: false,
          resolution: "1920x1080",
          fps: 29.97,
          videoCodec: "hvc1.1.6",
          videoBitrateKbps: 1266.4,
          audioCodec: "mp4a.40.2",
          audioBitrateKbps: 128.1,
          audioExtension: "m4a",
        },
      });
      const a1 = task("a1", "已完成子视频", "completed", group("A", "修复合集", 1));
      const a2 = task("a2", "下载中子视频", "downloading", group("A", "修复合集", 2));
      const tasks = [
        a1,
        a2,
        {
          ...task(
            "old-hidden-history",
            "已删除文件的旧任务",
            "completed",
            group("A", "修复合集", 9),
          ),
          batchId: "archived-round",
        },
        {
          ...task("old-legacy", "旧版已完成任务", "completed", group("A", "修复合集", 10)),
          batchId: null,
        },
        task("b1", "其他视频", "completed", group("B", "其他合集", 1)),
        task("single", "普通单视频", "queued", null),
        ...Array.from({ length: 20 }, (_, i) =>
          task("p" + i, "分P " + i, "queued", group("P", "独立多P", i + 1, "multipart")),
        ),
      ];
      const record = (t) => ({
        taskId: t.id,
        title: t.title,
        group: t.group,
        outputPaths: ["/fixture/" + t.id + ".mp4"],
        totalBytes: 1024,
        completedAtUnixMs: t.createdAtUnixMs,
      });
      const history = [
        record(a1),
        record({ ...a1, id: "a1-old", title: "历史版本" }),
        record(tasks.find((t) => t.id === "b1")),
      ];
      const f = (window.fixture = {
        tasks,
        history,
        calls: [],
        callbacks: {},
        handlers: {},
        counter: 0,
        partial: false,
        coverError: false,
        missingFile: false,
      });
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback(cb) {
          const id = ++f.counter;
          f.callbacks[id] = cb;
          return id;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          f.calls.push({ command, args });
          if (command === "plugin:event|listen") {
            f.handlers[args.event] = args.handler;
            return 1;
          }
          if (command === "get_download_tasks") return f.tasks;
          if (command === "get_download_history")
            return f.history.filter(
              (r) =>
                !args.query || r.title.includes(args.query) || r.group?.title.includes(args.query),
            );
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
          if (command === "get_record_thumbnail") {
            if (args.refresh && f.coverError)
              throw { code: "network_failure", message: "封面测试网络失败", retryable: true };
            const canvas = document.createElement("canvas");
            canvas.width = 128;
            canvas.height = 72;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#1d5178";
            ctx.fillRect(0, 0, 128, 72);
            ctx.fillStyle = "#66b9dd";
            ctx.fillRect(12, 36, 104, 20);
            return canvas.toDataURL("image/png");
          }
          if (command === "get_history_file_presence")
            return {
              state: args.taskId === "b1" && f.missingFile ? "missing" : "present",
              missingCount: args.taskId === "b1" && f.missingFile ? 1 : 0,
              totalCount: 1,
            };
          if (command === "get_record_group_file_presence")
            return {
              state: args.groupKey === "B" && f.missingFile ? "missing" : "present",
              missingCount: args.groupKey === "B" && f.missingFile ? 1 : 0,
              totalCount: 1,
            };
          if (command === "redownload_missing_history") {
            const copy = task("b1-copy", "手动重下", "queued", group("B", "其他合集", 1), 100);
            copy.batchId = "manual-new-round";
            f.tasks.push(copy);
            return copy;
          }
          if (command === "get_record_group_members")
            return (args.history ? f.history : f.tasks.filter((t) => t.status !== "completed"))
              .filter((t) => t.group?.key === args.groupKey)
              .map((t) => t.taskId ?? t.id);
          if (command === "delete_record_group") {
            const removedIds = f.partial ? args.taskIds.slice(0, 1) : args.taskIds;
            if (args.history) f.history = f.history.filter((t) => !removedIds.includes(t.taskId));
            else f.tasks = f.tasks.filter((t) => !removedIds.includes(t.id));
            return { removedIds, error: f.partial ? "测试部分删除失败" : null };
          }
          if (command === "delete_download_task") {
            f.tasks = f.tasks.filter((t) => t.id !== args.taskId);
            return true;
          }
          if (command === "retry_download") {
            const task = f.tasks.find((t) => t.id === args.taskId);
            task.status = "queued";
            return task;
          }
          if (command === "cancel_download") {
            const task = f.tasks.find((t) => t.id === args.taskId);
            task.status = "cancelled";
            return task;
          }
          if (command === "list_media_versions") return [];
          return null;
        },
      };
      const emit = (event, payload) =>
        f.callbacks[f.handlers[event]]({ payload: { schemaVersion: 1, payload } });
      window.finish = (id) => {
        const t = f.tasks.find((t) => t.id === id);
        t.status = "completed";
        f.history.push(record(t));
        emit("download://result", {
          taskId: id,
          title: t.title,
          outputPaths: ["/fixture/" + id + ".mp4"],
          totalBytes: 1024,
        });
        emit("download://state-changed", { ...t });
      };
      window.addWork = () => {
        const t = task("a3", "更新子视频", "queued", group("A", "修复合集", 3), 99);
        t.batchId = "new-round";
        f.tasks.push(t);
        emit("download://state-changed", t);
      };
    });
    const route = (zh, eng) => page.getByRole("link", { name: en ? eng : zh, exact: true });
    await page.goto((process.argv[3] ?? "http://127.0.0.1:1421/") + "#/tasks");
    const tasksRoot = page.locator(".task-list-page:not(.history-page)");
    const taskGroups = tasksRoot.locator(".record-group");
    const a = taskGroups.filter({ has: page.getByText("修复合集", { exact: true }) });
    const p = taskGroups.filter({ has: page.getByText("独立多P", { exact: true }) });
    await a.waitFor();
    assert.equal(await taskGroups.count(), 2);
    assert.equal(await tasksRoot.getByText("其他合集", { exact: true }).count(), 0);
    assert.equal(await tasksRoot.getByText("已完成子视频", { exact: true }).count(), 0);
    await a.locator(".record-cover img").waitFor();
    const currentProgress = a.getByRole("progressbar", {
      name: en ? "Group completion: 修复合集" : "分组完成进度：修复合集",
      exact: true,
    });
    assert.equal(await currentProgress.getAttribute("aria-valuenow"), "50");
    const toggle = (g, title, open) =>
      g.getByRole("button", {
        name: en
          ? (open ? "Expand group: " : "Collapse group: ") + title
          : (open ? "展开分组：" : "收起分组：") + title,
        exact: true,
      });
    await toggle(a, "修复合集", true).click();
    await a.getByText("下载中子视频", { exact: true }).waitFor();
    await a
      .getByText((en ? "Video: " : "视频：") + "1920×1080 · 29.97 FPS · HEVC · 1266 kbps · MP4", {
        exact: true,
      })
      .waitFor();
    await a
      .getByText((en ? "Audio: " : "音频：") + "AAC · 128 kbps · M4A", { exact: true })
      .waitFor();
    assert.equal(await a.getByText("已完成子视频", { exact: true }).count(), 0);
    await page.screenshot({ path: `/tmp/savebeam-active-cards-${locale}.png` });
    await page.evaluate(() => window.finish("a2"));
    await a.waitFor({ state: "hidden" });
    await route("历史", "History").click();
    const historyRoot = page.locator(".history-page");
    const historyA = historyRoot
      .locator(".record-group")
      .filter({ has: page.getByText("修复合集", { exact: true }) });
    await historyA.waitFor();
    assert.equal(await historyRoot.getByRole("progressbar").count(), 0);
    await historyA.getByText(en ? "3 records" : "共 3 条记录", { exact: false }).waitFor();
    await toggle(historyA, "修复合集", true).click();
    await historyA.getByText("历史版本", { exact: true }).waitFor();
    await historyA
      .getByRole("button", { name: en ? "Select videos" : "选择视频", exact: true })
      .click();
    await page.getByRole("textbox", { name: en ? "Video URL" : "视频链接", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: en ? "Video URL" : "视频链接", exact: true })
        .inputValue(),
      "https://example.invalid/A",
    );
    await route("任务", "Tasks").click();
    await page.evaluate(() => window.addWork());
    await a.waitFor({ state: "visible" });
    assert.equal(await currentProgress.getAttribute("aria-valuenow"), "0");
    await route("历史", "History").click();
    await historyA.waitFor({ state: "visible" });
    await route("任务", "Tasks").click();
    await a.waitFor({ state: "visible" });
    await page.evaluate(() => window.finish("a3"));
    await a.waitFor({ state: "hidden" });
    await toggle(p, "独立多P", true).click();
    const list = p.locator(".record-group-list");
    await list.evaluate((el) => (el.scrollTop = 200));
    await page.waitForTimeout(100);
    await route("历史", "History").click();
    await historyRoot.waitFor({ state: "visible" });
    await route("任务", "Tasks").click();
    await p.waitFor({ state: "visible" });
    assert.equal(await list.evaluate((el) => el.scrollTop), 200);
    await p.getByRole("button", { name: en ? "Delete group" : "删除整组", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: en ? "Delete group" : "删除整组",
      exact: true,
    });
    await dialog
      .getByText(en ? "Confirmed scope: 20 records." : "本次确认范围：20 条记录。", { exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: en ? "Confirm group deletion" : "确认删除整组", exact: true })
      .click();
    await p.waitFor({ state: "hidden" });
    assert.equal(await tasksRoot.getByText("普通单视频", { exact: true }).count(), 1);
    await route("历史", "History").click();
    await historyA.waitFor({ state: "visible" });
    const search = historyRoot.getByRole("textbox", {
      name: en ? "Search title or file path" : "搜索标题或文件路径",
      exact: true,
    });
    await search.fill("历史版本");
    await search.press("Enter");
    await historyA
      .getByText(en ? "1 records in current results" : "当前结果 1 条记录", { exact: false })
      .waitFor();
    await historyA
      .getByRole("button", { name: en ? "Delete group" : "删除整组", exact: true })
      .click();
    await dialog
      .getByText(en ? "Confirmed scope: 4 records." : "本次确认范围：4 条记录。", { exact: true })
      .waitFor();
    assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
    await dialog.getByRole("checkbox").check();
    await page.evaluate(() => (window.fixture.partial = true));
    await dialog
      .getByRole("button", { name: en ? "Confirm group deletion" : "确认删除整组", exact: true })
      .click();
    await dialog.getByRole("alert").filter({ hasText: "测试部分删除失败" }).waitFor();
    await dialog.getByRole("button", { name: en ? "Cancel" : "取消", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await search.fill("");
    await search.press("Enter");
    await historyA.getByText(en ? "3 records" : "共 3 条记录", { exact: false }).waitFor();
    await page.screenshot({ path: `/tmp/savebeam-history-cards-${locale}.png` });
    await historyA
      .getByRole("button", { name: en ? "Delete group" : "删除整组", exact: true })
      .click();
    assert.equal(await dialog.getByRole("checkbox").isChecked(), false);
    await page.evaluate(() => (window.fixture.partial = false));
    await dialog
      .getByRole("button", { name: en ? "Confirm group deletion" : "确认删除整组", exact: true })
      .click();
    await historyA.waitFor({ state: "hidden" });
    assert.equal(await historyRoot.getByText("其他合集", { exact: true }).count(), 1);
    const calls = await page.evaluate(() =>
      window.fixture.calls.filter((c) => c.command === "delete_record_group"),
    );
    assert.equal(calls[0].args.history, false);
    assert.equal(calls[0].args.deleteFiles, false);
    assert.equal(calls[1].args.history, true);
    assert.equal(calls[1].args.deleteFiles, true);
    assert.equal(calls[1].args.taskIds.length, 4);
    assert.equal(calls[2].args.deleteFiles, false);
    const other = historyRoot
      .locator(".record-group")
      .filter({ has: page.getByText("其他合集", { exact: true }) });
    await other.locator(".record-cover img").waitFor();
    await page.evaluate(() => (window.fixture.coverError = true));
    await other
      .getByRole("button", { name: en ? "Refresh cover" : "刷新封面", exact: true })
      .click();
    await other.getByRole("alert").waitFor();
    assert.equal(await other.locator(".record-cover img").count(), 1);
    assert.equal(
      await other
        .getByText(en ? "Files deleted (1/1)" : "文件已删除（1/1）", { exact: true })
        .count(),
      0,
    );
    await page.evaluate(() => (window.fixture.missingFile = true));
    await historyRoot
      .getByRole("button", { name: en ? "Refresh file status" : "刷新文件状态", exact: true })
      .click();
    await other
      .getByText(en ? "Files deleted (1/1)" : "文件已删除（1/1）", { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => window.fixture.calls.filter((c) => c.command === "redownload_missing_history").length,
      ),
      0,
    );
    await toggle(other, "其他合集", true).click();
    await other
      .getByRole("button", { name: en ? "Download again" : "重新下载", exact: true })
      .click();
    await other
      .getByRole("button", { name: en ? "Added to Tasks" : "已加入任务列表", exact: true })
      .waitFor();
    assert.deepEqual(
      await page.evaluate(
        () =>
          window.fixture.calls.filter((c) => c.command === "redownload_missing_history").at(-1)
            .args,
      ),
      { taskId: "b1" },
    );
    await page.screenshot({ path: `/tmp/savebeam-missing-history-${locale}.png` });
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      `${locale}: covers, completion/archive/update lifecycle, reselect, whole-group scope, partial failure and retained scroll passed\n`,
    );
  }
} finally {
  await browser.close();
}
