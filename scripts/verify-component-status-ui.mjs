// All inventory/catalog/paths are fixtures; no network, installations or user data access.
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.isTauri = true;
    window.componentFixture = {
      calls: [],
      probeFail: false,
      releaseFail: true,
      empty: false,
      delay: 50,
      runtimeStatus: "available",
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback() {
        return 1;
      },
      unregisterCallback() {},
      async invoke(command, args = {}) {
        const state = window.componentFixture;
        state.calls.push({ command, args });
        if (command === "get_component_status") {
          if (state.probeFail)
            throw { code: "unknown", message: "本地探测失败 fixture", retryable: true };
          return ["yt_dlp", "ffmpeg", "ffprobe", "java_script_runtime"].map((kind) => ({
            kind,
            status: kind === "java_script_runtime" ? state.runtimeStatus : "available",
            source: "system",
            executablePath: `/fixture/${kind}`,
            version: "1.0",
          }));
        }
        if (command === "get_component_releases") {
          await new Promise((resolve) => window.setTimeout(resolve, state.delay));
          if (state.releaseFail)
            throw { code: "network_failure", message: "在线目录暂不可用 fixture", retryable: true };
          return state.empty
            ? []
            : [
                {
                  kind: "java_script_runtime",
                  version: "2.0",
                  targetOs: "mac_os",
                  architecture: "aarch64",
                  provider: "fixture provider",
                  url: "https://example.invalid/deno",
                  sha256: "a".repeat(64),
                  sizeBytes: 10,
                  archive: "raw",
                  executableName: "deno",
                },
              ];
        }
        if (command === "set_component_custom_path") return null;
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
        if (command.startsWith("plugin:event|")) return 1;
        return [];
      },
    };
  });
  await page.goto(`${base}#/settings`);
  await page.getByRole("tab", { name: "运行组件", exact: true }).click();
  const ready = page.getByRole("status").filter({ hasText: "4 项组件均可用" });
  await ready.waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  assert.equal(
    (await page.evaluate(() => window.componentFixture.calls)).filter(
      (c) => c.command === "get_component_releases",
    ).length,
    0,
  );
  const runtime = page
    .locator(".mantine-Paper-root")
    .filter({ has: page.getByText("/fixture/java_script_runtime", { exact: true }) });
  await runtime.getByText("JavaScript runtime", { exact: true }).waitFor();
  assert.match(await runtime.innerText(), /Deno 使用 MIT/);
  assert.ok(!(await runtime.innerText()).includes("FFmpeg 构建许可"));
  await runtime
    .getByRole("textbox", { name: "自定义可执行文件路径", exact: true })
    .fill("/fixture/deno");
  await runtime.getByRole("button", { name: "使用此路径", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.componentFixture.calls)).find(
      (c) => c.command === "set_component_custom_path",
    ).args.kind,
    "javascript_runtime",
  );
  const check = page.getByRole("button", { name: "检查组件更新", exact: true });
  await check.click();
  let alert = page.getByRole("alert").filter({ hasText: "在线组件目录暂不可用" });
  await alert.waitFor();
  assert.match(await alert.innerText(), /不影响已经可用的本机组件/);
  await ready.waitFor();
  await page.getByRole("button", { name: "重新检测", exact: true }).click();
  await ready.waitFor();
  await alert.waitFor(); // A local probe must not falsely claim an online retry succeeded.
  await alert.getByRole("button", { name: "关闭在线检查提示", exact: true }).click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.evaluate(() => {
    window.componentFixture.probeFail = true;
  });
  await page.getByRole("button", { name: "重新检测", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "本机组件检测失败" }).waitFor();
  assert.equal(await ready.count(), 0);
  await page.getByText("下方保留上次成功检测结果，当前状态尚未确认。", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.componentFixture.probeFail = false;
    window.componentFixture.runtimeStatus = "missing";
  });
  await page.getByRole("button", { name: "重新检测", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "3/4 项可用" }).waitFor();
  await page.evaluate(() => {
    window.componentFixture.runtimeStatus = "available";
    window.componentFixture.releaseFail = false;
  });
  await page.getByRole("button", { name: "重新检测", exact: true }).click();
  await ready.waitFor();
  await check.click();
  await page.getByRole("status").filter({ hasText: "在线组件目录已读取" }).waitFor();
  await runtime.getByText("GitHub Releases：2.0 · fixture provider", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.componentFixture.releaseFail = true;
  });
  await check.click();
  await page.getByRole("alert").filter({ hasText: "在线组件目录暂不可用" }).waitFor();
  assert.equal(
    await page.getByText("GitHub Releases：2.0 · fixture provider", { exact: true }).count(),
    0,
  );
  await page.evaluate(() => {
    window.componentFixture.releaseFail = false;
    window.componentFixture.empty = true;
  });
  await check.click();
  await page.getByRole("status").filter({ hasText: "当前平台暂无可用的应用管理发行包" }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.getByRole("link", { name: "任务", exact: true }).click();
  const countBefore = (await page.evaluate(() => window.componentFixture.calls)).filter(
    (c) => c.command === "get_component_releases",
  ).length;
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await ready.waitFor();
  assert.equal(
    (await page.evaluate(() => window.componentFixture.calls)).filter(
      (c) => c.command === "get_component_releases",
    ).length,
    countBefore,
  );
  assert.deepEqual(errors, []);
  assert.ok(
    !(await page.evaluate(() => window.componentFixture.calls)).some((c) =>
      /install_component|remove_managed/.test(c.command),
    ),
  );
  process.stdout.write(
    "Component status: local/online separation, explicit check, failures/recovery, stale catalog clearing, missing runtime, legacy wire kind and draft retention passed\n",
  );
} finally {
  await browser.close();
}
