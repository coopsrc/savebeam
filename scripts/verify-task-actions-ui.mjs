// Fixture IPC only. No native files are opened and no media/cookies are downloaded/read.
/* global window, structuredClone */
// node scripts/verify-task-actions-ui.mjs /absolute/path/to/playwright/index.mjs [baseURL]
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
const task = {
  id: "completed-task",
  url: "https://example.invalid/watch?v=video&list=series#part",
  title: "已完成的测试视频",
  formatId: "video+audio",
  status: "completed",
  createdAtUnixMs: 1000,
};
try {
  for (const scenario of [
    "completed",
    "restart",
    "multiple",
    "no-history",
    "read-error",
    "open-error",
    "reparse",
    "states",
    "delete",
    "delete-error",
  ]) {
    const page = await browser.newPage({ viewport: { width: 1160, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ task, scenario }) => {
        window.isTauri = true;
        window.calls = [];
        window.taskRows =
          window.sessionStorage.getItem("fixture-task-deleted") === "yes" ? [] : [task];
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        const record = {
          taskId: task.id,
          title: task.title,
          totalBytes: 2048,
          completedAtUnixMs: 2000,
          outputPaths:
            scenario === "multiple"
              ? ["/fixture/课程/1-第一课 [v1].mp4", "/fixture/课程/2-第二课 [v2].mp4"]
              : ["/fixture/标题 [video].mp4"],
        };
        window.__TAURI_INTERNALS__ = {
          transformCallback() {
            return 1;
          },
          unregisterCallback() {},
          async invoke(command, args = {}) {
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
            window.calls.push({ command, args });
            if (command === "get_download_tasks")
              return scenario === "states"
                ? ["queued", "downloading", "failed", "cancelled", "cancelling"].map((status) => ({
                    ...task,
                    id: status,
                    title: status,
                    status,
                  }))
                : structuredClone(window.taskRows);
            if (command === "delete_download_task") {
              if (scenario === "delete-error")
                throw {
                  code: "permission_denied",
                  message: "测试：任务尚未停止，不能删除",
                  retryable: true,
                };
              window.taskRows = [];
              window.sessionStorage.setItem("fixture-task-deleted", "yes");
              return true;
            }
            if (command === "get_download_history_record") {
              if (scenario === "read-error")
                throw {
                  code: "unknown",
                  message: "测试：无法读取本地历史",
                  retryable: true,
                  diagnostic: "SECRET_DIAGNOSTIC",
                };
              return scenario === "no-history" ? null : structuredClone(record);
            }
            if (command === "open_history_file" && scenario === "open-error")
              throw {
                code: "invalid_path",
                message: "本地文件或目录已不存在。",
                retryable: false,
                diagnostic: "SECRET_DIAGNOSTIC",
              };
            if (command === "cancel_download" || command === "retry_download")
              return {
                ...task,
                id: args.taskId,
                title: args.taskId,
                status: command === "cancel_download" ? "cancelled" : "queued",
              };
            if (command.startsWith("plugin:event|")) return 1;
            return [];
          },
        };
      },
      { task, scenario },
    );
    await page.goto(`${base}#/tasks`);
    if (scenario === "states") {
      for (const status of ["queued", "downloading"]) {
        const card = page.getByRole("region", { name: `任务：${status}`, exact: true });
        await card.getByRole("button", { name: "取消", exact: true }).waitFor();
        assert.equal(await card.getByRole("button", { name: "打开文件", exact: true }).count(), 0);
        assert.equal(await card.getByRole("button", { name: "删除任务", exact: true }).count(), 0);
      }
      await page
        .getByRole("region", { name: "任务：failed", exact: true })
        .getByRole("button", { name: "重试", exact: true })
        .click();
      await page
        .getByRole("region", { name: "任务：failed", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .waitFor();
      await page
        .getByRole("region", { name: "任务：queued", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .click();
      await page
        .getByRole("region", { name: "任务：queued", exact: true })
        .getByRole("button", { name: "重试", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(() =>
          window.calls.some((call) => call.command === "get_download_history_record"),
        ),
        false,
      );
    } else {
      const card = page.getByRole("region", { name: `任务：${task.title}`, exact: true });
      const open = card.getByRole("button", { name: "打开文件", exact: true });
      await card.getByRole("button", { name: "重新解析", exact: true }).waitFor();
      if (scenario === "restart") {
        await page.reload();
        await open.waitFor();
      }
      if (["completed", "restart", "multiple", "open-error"].includes(scenario)) {
        await card.getByText(/已保存：/).waitFor();
        if (scenario === "multiple") {
          await card.getByLabel("下载文件", { exact: true }).click();
          await page.getByRole("option", { name: "2. 2-第二课 [v2].mp4", exact: true }).click();
          await card.getByText(/已保存：.*2-第二课/).waitFor();
        }
        await open.click();
        if (scenario === "open-error") {
          await card.getByRole("alert").filter({ hasText: "本地文件或目录已不存在" }).waitFor();
          assert.equal(await page.getByText("SECRET_DIAGNOSTIC").count(), 0);
          assert.equal(await open.isEnabled(), true);
        } else {
          await card.getByRole("button", { name: "打开所在文件夹", exact: true }).click();
          const calls = await page.evaluate(() =>
            window.calls.filter((call) => call.command.startsWith("open_history_")),
          );
          assert.deepEqual(
            calls.map((call) => call.args),
            [0, 1].map(() => ({ taskId: task.id, outputIndex: scenario === "multiple" ? 1 : 0 })),
          );
          assert.equal(
            calls.some((call) => "path" in call.args),
            false,
          );
          if (scenario === "completed")
            await page.screenshot({ path: "/tmp/savebeam-task-actions-ui.png", fullPage: true });
        }
      }
      if (scenario === "no-history") {
        await card.getByText(/下载历史已删除或未能保存/).waitFor();
        assert.equal(await open.isDisabled(), true);
        assert.equal(
          await card.getByRole("button", { name: "重新解析", exact: true }).isEnabled(),
          true,
        );
      }
      if (scenario === "read-error") {
        await card.getByRole("alert").filter({ hasText: "测试：无法读取本地历史" }).waitFor();
        assert.equal(await open.isDisabled(), true);
        assert.equal(await page.getByText("SECRET_DIAGNOSTIC").count(), 0);
      }
      if (scenario === "reparse") {
        await card.getByRole("button", { name: "重新解析", exact: true }).click();
        assert.equal(
          await page.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
          task.url,
        );
        assert.equal(
          await page.evaluate(() =>
            window.calls.some((call) =>
              ["start_download", "retry_download", "inspect_media"].includes(call.command),
            ),
          ),
          false,
        );
      }
      if (scenario === "completed") {
        await card.getByRole("button", { name: "查看历史", exact: true }).click();
        await page.getByRole("heading", { name: "下载历史", exact: true }).waitFor();
      }
      if (scenario === "delete" || scenario === "delete-error") {
        await card.getByRole("button", { name: "删除任务", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "删除任务", exact: true });
        await dialog.getByText(/保留下载文件、历史记录/).waitFor();
        await dialog.getByRole("button", { name: "返回", exact: true }).click();
        assert.equal(
          await page.evaluate(() =>
            window.calls.some((call) => call.command === "delete_download_task"),
          ),
          false,
        );
        await card.getByRole("button", { name: "删除任务", exact: true }).click();
        await dialog.getByRole("button", { name: "确认删除任务", exact: true }).click();
        if (scenario === "delete-error") {
          await dialog.getByRole("alert").filter({ hasText: "任务尚未停止" }).waitFor();
          assert.equal(await card.count(), 1);
          assert.equal(
            await dialog.getByRole("button", { name: "确认删除任务", exact: true }).isEnabled(),
            true,
          );
        } else {
          await page.getByRole("heading", { name: "还没有下载任务", exact: true }).waitFor();
          assert.deepEqual(
            await page.evaluate(() =>
              window.calls
                .filter((call) => call.command === "delete_download_task")
                .map((call) => call.args),
            ),
            [{ taskId: task.id }],
          );
          assert.equal(
            await page.evaluate(() =>
              window.calls.some((call) => call.command === "delete_download_history"),
            ),
            false,
          );
          await page.reload();
          await page.getByRole("heading", { name: "还没有下载任务", exact: true }).waitFor();
          assert.equal(await card.count(), 0);
        }
      }
    }
    assert.deepEqual(errors, []);
    process.stdout.write(`${scenario}: passed\n`);
    await page.close();
  }
} finally {
  await browser.close();
}
