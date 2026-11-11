// Fixture IPC only. No files opened or media downloaded.
/* global window */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const status of [
    "queued",
    "downloading",
    "post_processing",
    "failed",
    "cancelled",
    "completed",
  ]) {
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ status }) => {
        window.isTauri = true;
        window.calls = [];
        const task = {
          id: "one",
          title: "测试单视频",
          url: "https://example.invalid/video",
          formatId: "v+a",
          status,
          createdAtUnixMs: 1,
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        window.__TAURI_INTERNALS__ = {
          transformCallback() {
            return 1;
          },
          unregisterCallback() {},
          async invoke(command, args = {}) {
            window.calls.push({ command, args });
            if (command === "get_download_tasks") return [task];
            if (command === "get_record_thumbnail") return null;
            if (command === "get_download_history")
              return status === "completed"
                ? [
                    {
                      taskId: "one",
                      title: "测试单视频",
                      outputPaths: ["/fixture/video.mp4"],
                      totalBytes: 1024,
                      completedAtUnixMs: 2,
                    },
                  ]
                : [];
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
            if (command === "retry_download") return { ...task, status: "queued" };
            if (command === "cancel_download") return { ...task, status: "cancelled" };
            if (command === "delete_download_task") return true;
            return null;
          },
        };
      },
      { status },
    );
    await page.goto((process.argv[3] ?? "http://127.0.0.1:1421/") + "#/tasks");
    const card = page.getByRole("region", { name: "任务：测试单视频", exact: true });
    if (status === "completed") {
      await page.getByText("暂无未完成任务", { exact: true }).waitFor();
      assert.equal(await card.count(), 0);
      await page.getByRole("link", { name: "历史", exact: true }).click();
      await page.locator(".history-page").getByText("测试单视频", { exact: true }).waitFor();
      assert.equal(await page.locator(".history-page").getByRole("progressbar").count(), 0);
    } else {
      await card.waitFor();
      if (["queued", "downloading", "post_processing"].includes(status)) {
        await card.getByRole("button", { name: "取消", exact: true }).click();
        await card.getByRole("status", { name: "下载任务状态：已取消", exact: true }).waitFor();
        assert.deepEqual(
          await page.evaluate(() => window.calls.find((c) => c.command === "cancel_download").args),
          { taskId: "one" },
        );
      } else {
        await card.getByRole("button", { name: "重试", exact: true }).click();
        await card.getByRole("status", { name: "下载任务状态：排队中", exact: true }).waitFor();
        assert.deepEqual(
          await page.evaluate(() => window.calls.find((c) => c.command === "retry_download").args),
          { taskId: "one" },
        );
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(status + ": task/history lifecycle and single actions passed\n");
  }
} finally {
  await browser.close();
}
