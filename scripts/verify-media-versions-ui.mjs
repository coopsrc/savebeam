// Fixture IPC only. Never reads real cookies/files or contacts a video website.
/* global window, document, structuredClone */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
try {
  for (const scenario of [
    "unknown",
    "possible_change",
    "no_obvious_change",
    "identity_changed",
    "check-error",
    "download-error",
    "list-error",
    "retention",
    "task-entry",
  ]) {
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(
      ({ scenario }) => {
        window.isTauri = true;
        const task = {
          id: "root",
          title: "旧视频",
          url: "https://example.invalid/v",
          formatId: "v+a",
          status: "completed",
          createdAtUnixMs: 1,
        };
        const record = {
          taskId: "root",
          title: task.title,
          totalBytes: 10,
          outputPaths: ["/fixture/old.mp4"],
          completedAtUnixMs: 2,
        };
        const versions = [
          {
            taskId: "child",
            rootTaskId: "root",
            parentTaskId: "root",
            versionNumber: 2,
            completedAtUnixMs: 4,
            source: { mediaId: "v" },
            files: [
              {
                path: "/fixture/Savebeam Versions/root/new.mp4",
                sizeBytes: 20,
                sha256: "b".repeat(64),
              },
            ],
          },
          {
            taskId: "root",
            rootTaskId: "root",
            parentTaskId: null,
            versionNumber: 1,
            completedAtUnixMs: 2,
            source: null,
            files: [{ path: "/fixture/old.mp4", sizeBytes: 10, sha256: "a".repeat(64) }],
          },
        ];
        window.fixture = { calls: [], task, record, versions };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        const fail = (message) => {
          throw {
            code: "network_failure",
            message,
            retryable: true,
            diagnostic: "SECRET_DIAGNOSTIC",
          };
        };
        window.__TAURI_INTERNALS__ = {
          transformCallback() {
            return 1;
          },
          unregisterCallback() {},
          async invoke(command, args = {}) {
            window.fixture.calls.push({ command, args: structuredClone(args) });
            if (command === "get_download_tasks") return [task];
            if (command === "get_download_history_record") return record;
            if (command === "get_download_history") return [record];
            if (command === "list_media_versions") {
              if (scenario === "list-error") fail("版本读取失败");
              return versions;
            }
            if (command === "check_history_source") {
              if (scenario === "check-error") fail("来源暂时不可用");
              const status = ["retention", "download-error", "list-error", "task-entry"].includes(
                scenario,
              )
                ? "unknown"
                : scenario;
              return {
                current: { mediaId: "v" },
                title: "当前视频",
                comparison: {
                  status,
                  reasons: [status === "unknown" ? "旧下载缺少来源基线" : "测试元数据比较结果"],
                },
              };
            }
            if (command === "redownload_media_version") {
              if (scenario === "download-error") fail("来源标识在重检时改变，已拒绝下载");
              return { ...task, id: "new-version", status: "queued", title: "新版本" };
            }
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
            return null;
          },
        };
      },
      { scenario },
    );
    const route = scenario === "task-entry" ? "/tasks" : "/history";
    await page.goto(`${base}#${route}`);
    await page.getByRole("button", { name: "来源与版本", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "来源与历史版本", exact: true });
    await dialog.waitFor();
    const check = dialog.getByRole("button", { name: "检查来源变化", exact: true });
    const download = dialog.getByRole("button", { name: "重新下载并保留旧版本", exact: true });
    if (scenario === "list-error") {
      await dialog.getByRole("alert").filter({ hasText: "版本读取失败" }).waitFor();
    } else {
      await dialog.getByText("版本 2", { exact: true }).waitFor();
      await dialog.getByText(/与上一版本文件不同（不等于确认换源）/).waitFor();
    }
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="dialog"] button[disabled]') ||
        Array.from(document.querySelectorAll('[role="dialog"] button')).some(
          (b) => b.textContent === "检查来源变化" && !b.disabled,
        ),
    );
    assert.equal(await download.isDisabled(), true);
    assert.equal(
      await page.evaluate(() =>
        window.fixture.calls.some((c) =>
          ["check_history_source", "redownload_media_version"].includes(c.command),
        ),
      ),
      false,
    );
    await check.click();
    if (scenario === "check-error") {
      await dialog.getByRole("alert").filter({ hasText: "来源暂时不可用" }).waitFor();
      assert.equal(await download.isDisabled(), true);
    } else {
      await dialog.getByRole("status").first().waitFor();
      assert.equal(await download.isDisabled(), scenario === "identity_changed");
      await dialog.getByRole("checkbox", { name: "使用代理", exact: true }).check();
      assert.equal(await download.isDisabled(), true);
      await check.click();
      await dialog.getByRole("status").first().waitFor();
      assert.deepEqual(
        await page.evaluate(() =>
          window.fixture.calls
            .filter((c) => c.command === "check_history_source")
            .map((c) => c.args),
        ),
        [
          { taskId: "root", useProxy: false },
          { taskId: "root", useProxy: true },
        ],
      );
      if (scenario === "retention") {
        await page.evaluate(() => {
          window.location.hash = "/tasks";
        });
        await page.getByRole("heading", { name: "任务", exact: true, level: 1 }).waitFor();
        await dialog.waitFor({ state: "hidden" });
        await page.getByRole("button", { name: "来源与版本", exact: true }).waitFor();
        await page.evaluate(() => {
          window.location.hash = "/history";
        });
        await dialog.waitFor();
        assert.equal(
          await dialog.getByRole("checkbox", { name: "使用代理", exact: true }).isChecked(),
          true,
        );
      }
      if (!["identity_changed", "list-error"].includes(scenario)) {
        await download.click();
        if (scenario === "download-error") {
          await dialog.getByRole("alert").filter({ hasText: "来源标识在重检时改变" }).waitFor();
          assert.equal(await download.isDisabled(), true);
        } else {
          await dialog.getByRole("status").filter({ hasText: "新版本已加入任务列表" }).waitFor();
          assert.equal(new URL(page.url()).hash, `#${route}`);
          assert.deepEqual(
            await page.evaluate(() =>
              window.fixture.calls
                .filter((c) => c.command === "redownload_media_version")
                .map((c) => c.args),
            ),
            [{ taskId: "root", useProxy: true }],
          );
        }
      }
    }
    await dialog.getByRole("button", { name: "刷新版本", exact: true }).click();
    await page.waitForFunction(
      () => window.fixture.calls.filter((c) => c.command === "list_media_versions").length === 2,
    );
    if (!["list-error"].includes(scenario)) {
      await dialog.getByRole("button", { name: "打开此版本", exact: true }).first().click();
      assert.deepEqual(
        await page.evaluate(
          () => window.fixture.calls.filter((c) => c.command === "open_history_file").at(-1).args,
        ),
        { taskId: "child", outputIndex: 0 },
      );
    }
    assert.equal(await page.getByText("SECRET_DIAGNOSTIC").count(), 0);
    if (scenario === "possible_change")
      await page.screenshot({ path: "/tmp/savebeam-media-versions-ui.png", fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(`PASS ${scenario}\n`);
  }
} finally {
  await browser.close();
}
