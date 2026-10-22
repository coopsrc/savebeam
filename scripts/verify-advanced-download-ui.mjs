// Fixture-only regression: advanced options, default settings and task snapshots.
/* global window, structuredClone, document */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const defaults = {
  audioOnly: false,
  subtitleLanguages: ["en"],
  writeAutomaticSubtitles: true,
  writeThumbnail: true,
  writeInfoJson: true,
  embedMetadata: true,
  keepIntermediateFiles: false,
};
async function fixture(mode, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    ({ mode, defaults }) => {
      window.isTauri = true;
      window.optionFixture = {
        defaults,
        calls: [],
        failLoad: mode === "load-error",
        failSave: false,
        delay: 0,
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          const state = window.optionFixture;
          state.calls.push({ command, args: structuredClone(args) });
          if (command === "get_download_option_defaults") {
            if (state.failLoad)
              throw { code: "unknown", message: "默认配置读取失败", retryable: true };
            return structuredClone(state.defaults);
          }
          if (command === "save_download_option_defaults") {
            await new Promise((resolve) => window.setTimeout(resolve, state.delay));
            if (state.failSave)
              throw { code: "unknown", message: "默认配置保存失败", retryable: true };
            state.defaults = structuredClone(args.options);
            return structuredClone(state.defaults);
          }
          if (command === "inspect_media")
            return {
              id: "fixture",
              title: "高级设置回归视频",
              uploader: "作者",
              webpageUrl: args.url,
              durationSeconds: 100,
              thumbnailUrl: null,
              thumbnailDataUrl: null,
              formats: [
                {
                  formatId: "audio",
                  extension: "m4a",
                  videoCodec: null,
                  audioCodec: "aac",
                  fileSizeBytes: 1024,
                },
                ...(mode === "audio-source"
                  ? []
                  : [
                      {
                        formatId: "video",
                        extension: "mp4",
                        videoCodec: "avc1",
                        audioCodec: null,
                        fileSizeBytes: 4096,
                        resolution: "1920x1080",
                      },
                    ]),
              ],
              subtitles: [{ language: "en", name: "English", extension: "vtt", automatic: true }],
              playlist: null,
            };
          if (command === "start_download")
            return {
              id: "option-task",
              title: args.options.title,
              url: args.options.url,
              formatId: args.options.formatId,
              status: "queued",
              createdAtUnixMs: 1,
            };
          if (command === "get_cookie_preferences")
            return { cookiesFilePath: null, cookiesBrowser: null, accessConfirmed: false };
          if (command === "get_download_preferences")
            return { outputDirectory: "", maxConcurrent: 1, conflictStrategy: "skip" };
          if (command === "get_network_preferences") return { proxyMode: "default", proxyUrl: "" };
          if (command.startsWith("plugin:event|")) return 1;
          return [];
        },
      };
    },
    { mode, defaults: structuredClone(defaults) },
  );
  return { page, errors };
}
try {
  for (const mode of ["single", "narrow", "audio-source", "load-error"]) {
    const { page, errors } = await fixture(mode, mode === "narrow" ? 560 : 1280);
    await page.goto(`${base}#/download`);
    const parse = page.getByRole("button", { name: "解析视频信息", exact: true });
    await page
      .getByRole("textbox", { name: "视频链接", exact: true })
      .fill("https://example.invalid/video");
    if (mode === "load-error") {
      await page.getByRole("alert").filter({ hasText: "默认配置读取失败" }).waitFor();
      assert.equal(await parse.isDisabled(), true);
      assert.equal(
        await page.evaluate(
          () =>
            window.optionFixture.calls.filter((item) => item.command === "inspect_media").length,
        ),
        0,
      );
      await page.evaluate(() => {
        window.optionFixture.failLoad = false;
      });
      await page.getByRole("button", { name: "重新读取下载选项", exact: true }).click();
    }
    await parse.click();
    const advanced = page.getByRole("button", { name: "高级设置", exact: true });
    await advanced.waitFor();
    assert.equal(
      await page.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).count(),
      0,
      "advanced controls must not occupy the main page",
    );
    await advanced.click();
    let dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
    const json = dialog.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true });
    assert.equal(await json.isChecked(), true);
    const audio = dialog.getByRole("checkbox", { name: "仅下载音频（MP3）", exact: true });
    assert.equal(await audio.isChecked(), mode === "audio-source");
    assert.equal(await audio.isDisabled(), mode === "audio-source");
    await json.uncheck();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await advanced.click();
    dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
    assert.equal(
      await dialog.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).isChecked(),
      true,
      "cancel discards draft",
    );
    await dialog.getByRole("checkbox", { name: "另存缩略图文件", exact: true }).uncheck();
    await page.keyboard.press("Escape");
    await advanced.click();
    dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
    assert.equal(
      await dialog.getByRole("checkbox", { name: "另存缩略图文件", exact: true }).isChecked(),
      true,
      "Escape discards draft",
    );
    if (mode === "single") {
      const languages = dialog.getByRole("combobox", { name: "下载字幕", exact: true });
      await languages.fill("--exec=bad");
      await languages.press("Enter");
      await dialog.getByRole("button", { name: "应用到本次下载", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "字幕语言最多 10 项" }).waitFor();
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await advanced.click();
      dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
    }
    await dialog.getByRole("checkbox", { name: "保留中间文件", exact: true }).check();
    await dialog.screenshot({ path: `/tmp/savebeam-advanced-${mode}.png` });
    const overflow = await dialog.evaluate((element) => ({
      scroll: element.scrollWidth,
      client: element.clientWidth,
    }));
    assert.ok(overflow.scroll <= overflow.client + 1);
    await dialog.getByRole("button", { name: "应用到本次下载", exact: true }).click();
    // A new global value must not replace an already edited, parsed task draft.
    await page.evaluate(() => {
      window.optionFixture.defaults.writeInfoJson = false;
      window.optionFixture.defaults.keepIntermediateFiles = false;
    });
    await parse.click();
    await advanced.click();
    dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
    assert.equal(
      await dialog.getByRole("checkbox", { name: "保留中间文件", exact: true }).isChecked(),
      true,
    );
    assert.equal(
      await dialog.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).isChecked(),
      true,
    );
    // Restore reads latest defaults, but cancellation must still retain the applied task snapshot.
    if (mode === "load-error") {
      await page.evaluate(() => {
        window.optionFixture.failLoad = true;
      });
      await dialog.getByRole("button", { name: "使用全局默认", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "默认配置读取失败" }).waitFor();
      assert.equal(
        await dialog.getByRole("checkbox", { name: "保留中间文件", exact: true }).isChecked(),
        true,
      );
      await page.evaluate(() => {
        window.optionFixture.failLoad = false;
      });
    }
    await dialog.getByRole("button", { name: "使用全局默认", exact: true }).click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('[role="dialog"] label')).find(
          (label) => label.textContent === "保留中间文件",
        )?.control?.checked === false,
    );
    await dialog.getByRole("checkbox", { name: "保留中间文件", exact: true }).waitFor();
    await dialog
      .getByRole("button", { name: mode === "load-error" ? "应用到本次下载" : "取消", exact: true })
      .click();
    await page.getByRole("button", { name: "开始下载", exact: true }).click();
    await page.waitForURL(/#\/tasks$/);
    const snapshot = await page.evaluate(
      () =>
        window.optionFixture.calls.find((item) => item.command === "start_download").args.options,
    );
    for (const [key, value] of Object.entries({
      ...defaults,
      audioOnly: mode === "audio-source",
      keepIntermediateFiles: mode !== "load-error",
      writeInfoJson: mode !== "load-error",
    }))
      assert.deepEqual(snapshot[key], value, key);
    assert.equal(
      await page.evaluate(
        () =>
          window.optionFixture.calls.filter(
            (item) => item.command === "save_download_option_defaults",
          ).length,
      ),
      0,
    );
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      `${mode}: inherited defaults, cancel/Escape, apply, reparse, latest-default restore cancel and task snapshot passed\n`,
    );
  }
  const { page, errors } = await fixture("settings");
  await page.goto(`${base}#/settings`);
  let panel = page.getByRole("region", { name: "下载选项默认配置", exact: true });
  await panel.waitFor();
  await panel.getByRole("checkbox", { name: "保留中间文件", exact: true }).check();
  await panel.getByRole("checkbox", { name: "另存缩略图文件", exact: true }).uncheck();
  await page.evaluate(() => {
    window.optionFixture.failSave = true;
    window.optionFixture.delay = 150;
  });
  await panel.getByRole("button", { name: "保存下载选项", exact: true }).click();
  assert.equal(
    await panel.getByRole("checkbox", { name: "保留中间文件", exact: true }).isDisabled(),
    true,
  );
  await panel.getByRole("alert").filter({ hasText: "默认配置保存失败" }).waitFor();
  assert.equal(
    await panel.getByRole("checkbox", { name: "保留中间文件", exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await page.evaluate(() => window.optionFixture.defaults.keepIntermediateFiles),
    false,
  );
  await page.evaluate(() => {
    window.optionFixture.failSave = false;
  });
  await panel.getByRole("button", { name: "保存下载选项", exact: true }).click();
  await panel.getByRole("status").waitFor();
  await page.getByRole("link", { name: "下载", exact: true }).click();
  await page
    .getByRole("textbox", { name: "视频链接", exact: true })
    .fill("https://example.invalid/video");
  await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
  await page.getByRole("button", { name: "高级设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
  assert.equal(
    await dialog.getByRole("checkbox", { name: "保留中间文件", exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await dialog.getByRole("checkbox", { name: "另存缩略图文件", exact: true }).isChecked(),
    false,
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  panel = page.getByRole("region", { name: "下载选项默认配置", exact: true });
  await panel.getByRole("button", { name: "恢复初始值", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.optionFixture.defaults.keepIntermediateFiles),
    true,
    "reset remains an unsaved draft",
  );
  await panel.screenshot({ path: "/tmp/savebeam-download-defaults.png" });
  assert.deepEqual(errors, []);
  await page.close();
  process.stdout.write(
    "settings: save failure/retry, loading lock, persisted defaults used by new task, unsaved reset passed\n",
  );
  const recovery = await fixture("load-error");
  await recovery.page.goto(`${base}#/settings`);
  const recoveryPanel = recovery.page.getByRole("region", {
    name: "下载选项默认配置",
    exact: true,
  });
  await recoveryPanel.getByRole("alert").filter({ hasText: "默认配置读取失败" }).waitFor();
  assert.equal(
    await recoveryPanel.getByRole("button", { name: "保存下载选项", exact: true }).isDisabled(),
    true,
  );
  await recoveryPanel.getByRole("button", { name: "恢复初始值", exact: true }).click();
  assert.equal(
    await recovery.page.evaluate(() => window.optionFixture.defaults.writeThumbnail),
    true,
    "explicit recovery is still only a draft",
  );
  await recoveryPanel.getByRole("button", { name: "保存下载选项", exact: true }).click();
  await recoveryPanel.getByRole("status").waitFor();
  assert.equal(
    await recovery.page.evaluate(() => window.optionFixture.defaults.writeThumbnail),
    false,
  );
  assert.deepEqual(recovery.errors, []);
  await recovery.page.close();
  process.stdout.write(
    "settings: unreadable defaults require explicit reset and save, never silent replacement passed\n",
  );
} finally {
  await browser.close();
}
