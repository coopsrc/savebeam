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
  page.setDefaultTimeout(15_000);
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
          if (command === "get_download_tasks")
            return mode === "reparse"
              ? [
                  {
                    id: "old-task",
                    url: "https://example.invalid/new-source?part=2&v=a#chapter",
                    title: "Old source",
                    formatId: "video+audio",
                    status: "completed",
                    createdAtUnixMs: 1,
                  },
                ]
              : [];
          if (command === "get_download_history_record") return null;
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
              subtitles: [
                { language: "en", name: "English", extension: "vtt", automatic: true },
                { language: "en", name: "English", extension: "srt", automatic: false },
                { language: "zh-Hans", name: "简体中文", extension: "vtt", automatic: false },
                { language: "ja", name: "日语", extension: "vtt", automatic: true },
              ],
              playlist: null,
            };
          if (command === "start_download") {
            if (state.holdQueue)
              await new Promise((resolve) => {
                state.releaseQueue = resolve;
              });
            state.queueReturned = true;
            return {
              id: "option-task",
              title: args.options.title,
              url: args.options.url,
              formatId: args.options.formatId,
              status: "queued",
              createdAtUnixMs: 1,
            };
          }
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
    if (mode === "single") {
      await page.getByRole("checkbox", { name: "使用代理", exact: true }).check();
      await page.getByRole("link", { name: "任务", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "任务", exact: true }).waitFor();
      assert.equal(
        await page.getByRole("textbox", { name: "视频链接", exact: true }).count(),
        0,
        "inactive draft is not accessible",
      );
      await page.getByRole("link", { name: "下载", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
        "https://example.invalid/video",
      );
      assert.equal(
        await page.getByRole("checkbox", { name: "使用代理", exact: true }).isChecked(),
        true,
      );
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
      const inspectionsBeforeSearch = await page.evaluate(
        () => window.optionFixture.calls.filter((call) => call.command === "inspect_media").length,
      );
      await languages.click();
      assert.equal(await page.getByRole("option").count(), 3, "same-language sources are grouped");
      await languages.fill("--exec=bad");
      await page.getByText("没有匹配的字幕语言", { exact: true }).waitFor();
      await languages.press("Enter");
      assert.equal(
        await page.evaluate(
          () =>
            window.optionFixture.calls.filter((call) => call.command === "inspect_media").length,
        ),
        inspectionsBeforeSearch,
        "Enter in subtitle search must not submit the page form",
      );
      assert.equal(
        await dialog.getByRole("button", { name: /移除字幕/ }).count(),
        1,
        "search never creates a language",
      );
      await languages.fill("zh-Hans");
      await page.getByRole("option", { name: /简体中文（zh-Hans）/ }).click();
      await languages.press("Tab");
      await dialog.getByRole("checkbox", { name: "同时下载自动生成的字幕", exact: true }).uncheck();
      await languages.fill("ja");
      await page.getByRole("option", { name: /日语（ja）/ }).click();
      await languages.press("Tab");
      await dialog
        .getByRole("checkbox", { name: "同时下载自动生成的字幕", exact: true })
        .and(page.locator("input:checked"))
        .waitFor();
      await dialog.screenshot({ path: "/tmp/savebeam-subtitle-multiselect.png" });
      await languages.click();
      await page.getByRole("option", { name: /English（en）/ }).waitFor();
      await page.screenshot({ path: "/tmp/savebeam-subtitle-dropdown.png" });
      await languages.press("Tab");
      await dialog.getByRole("button", { name: "移除字幕 ja", exact: true }).click();
      await dialog
        .getByRole("button", { name: "移除字幕 ja", exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(
        await dialog.getByRole("button", { name: "移除字幕 ja", exact: true }).count(),
        0,
      );
      await dialog.getByRole("button", { name: "清空字幕选择", exact: true }).click();
      await dialog
        .getByRole("checkbox", { name: "同时下载自动生成的字幕", exact: true })
        .and(page.locator("input:disabled"))
        .waitFor();
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
    if (mode === "single") {
      await page.getByRole("checkbox", { name: "手动选择音频", exact: true }).check();
      const before = await page.evaluate(
        () => window.optionFixture.calls.filter((call) => call.command === "inspect_media").length,
      );
      for (const route of ["任务", "历史", "订阅", "设置"]) {
        await page.getByRole("link", { name: route, exact: true }).click();
        await page.getByRole("heading", { level: 1, name: route, exact: true }).waitFor();
        assert.equal(await page.getByRole("textbox", { name: "视频链接", exact: true }).count(), 0);
        await page.getByRole("link", { name: "下载", exact: true }).click();
        await page.getByRole("region", { name: "媒体与格式", exact: true }).waitFor();
        assert.equal(
          await page.getByRole("checkbox", { name: "手动选择音频", exact: true }).isChecked(),
          true,
        );
      }
      assert.equal(
        await page.evaluate(
          () =>
            window.optionFixture.calls.filter((call) => call.command === "inspect_media").length,
        ),
        before,
        "navigation must not re-inspect media",
      );
      await page.locator(".dev-platform-switcher").getByText("macOS", { exact: true }).click();
      await advanced.click();
      dialog = page.getByRole("dialog", { name: "高级设置", exact: true });
      assert.equal(
        await dialog.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).isChecked(),
        true,
        "new global defaults do not replace the draft",
      );
      await dialog.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).uncheck();
      await dialog.getByRole("button", { name: "取消", exact: true }).focus();
      await page.keyboard.press("Meta+2");
      await page.waitForURL(/#\/tasks$/);
      await dialog.waitFor({ state: "hidden" });
      await page.getByRole("link", { name: "下载", exact: true }).click();
      await dialog.waitFor();
      assert.equal(
        await dialog.getByRole("checkbox", { name: "另存媒体信息 JSON", exact: true }).isChecked(),
        false,
        "unapplied modal draft resumes with the workspace",
      );
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await page.evaluate(() => {
        window.optionFixture.holdQueue = true;
      });
    }
    await page.getByRole("button", { name: "开始下载", exact: true }).click();
    if (mode === "single") {
      await page.getByRole("link", { name: "历史", exact: true }).click();
      await page.evaluate(() => window.optionFixture.releaseQueue());
      await page.waitForFunction(() => window.optionFixture.queueReturned === true);
      await page.locator(".download-page").waitFor({ state: "detached" });
      assert.match(page.url(), /#\/history$/, "background submission must not steal navigation");
      await page.getByRole("link", { name: "任务", exact: true }).click();
      await page.getByRole("region", { name: "任务：高级设置回归视频", exact: true }).waitFor();
      await page.getByRole("link", { name: "下载", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
        "",
        "successful submission consumes the draft",
      );
      assert.equal(await page.getByRole("region", { name: "媒体与格式", exact: true }).count(), 0);
    } else await page.waitForURL(/#\/tasks$/);
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
  const subtitleChoices = panel.getByRole("region", { name: "字幕选择", exact: true });
  const subtitleInput = subtitleChoices.getByRole("combobox", { name: "下载字幕", exact: true });
  for (const code of [
    "zh-Hans",
    "zh-Hant",
    "zh",
    "zh-CN",
    "zh-TW",
    "zh-HK",
    "en-US",
    "en-GB",
    "ja",
  ]) {
    await subtitleInput.fill(code);
    await page.getByRole("option", { name: new RegExp(`（${code}）`) }).click();
  }
  await subtitleInput.fill("");
  await subtitleChoices
    .getByText("已选满 10 种；取消一项后可继续选择。", { exact: true })
    .waitFor();
  assert.ok(
    (await page.getByRole("option").and(page.locator("[data-combobox-disabled]")).count()) > 0,
  );
  await subtitleInput.press("Tab");
  await subtitleChoices.getByRole("button", { name: "移除字幕 ja", exact: true }).click();
  assert.equal(await subtitleChoices.getByRole("button", { name: /移除字幕/ }).count(), 9);
  await panel.screenshot({ path: "/tmp/savebeam-subtitle-default-tags.png" });
  await subtitleChoices.getByRole("button", { name: "清空字幕选择", exact: true }).click();
  await subtitleInput.fill("en");
  await page.getByRole("option", { name: /英语（en）/ }).click();
  await subtitleInput.press("Tab");
  await panel.getByRole("checkbox", { name: "同时下载自动生成的字幕", exact: true }).check();
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
  const reparse = await fixture("reparse");
  await reparse.page.goto(`${base}#/download`);
  await reparse.page
    .getByRole("textbox", { name: "视频链接", exact: true })
    .fill("https://example.invalid/unfinished");
  await reparse.page.getByRole("button", { name: "解析视频信息", exact: true }).click();
  await reparse.page.getByRole("region", { name: "媒体与格式", exact: true }).waitFor();
  await reparse.page.getByRole("link", { name: "任务", exact: true }).click();
  await reparse.page.getByRole("button", { name: "重新解析", exact: true }).click();
  await reparse.page.getByRole("heading", { level: 1, name: "下载", exact: true }).waitFor();
  assert.equal(
    await reparse.page.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
    "https://example.invalid/new-source?part=2&v=a#chapter",
  );
  assert.equal(
    await reparse.page.getByRole("region", { name: "媒体与格式", exact: true }).count(),
    0,
    "new source does not inherit old media",
  );
  await reparse.page.getByRole("link", { name: "历史", exact: true }).click();
  await reparse.page.getByRole("heading", { level: 1, name: "历史", exact: true }).waitFor();
  await reparse.page.getByRole("link", { name: "下载", exact: true }).click();
  await reparse.page.getByRole("heading", { level: 1, name: "下载", exact: true }).waitFor();
  assert.equal(
    await reparse.page.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
    "https://example.invalid/new-source?part=2&v=a#chapter",
  );
  assert.equal(
    await reparse.page.evaluate(
      () => window.optionFixture.calls.filter((call) => call.command === "inspect_media").length,
    ),
    1,
    "prefill does not start parsing by itself",
  );
  assert.deepEqual(reparse.errors, []);
  await reparse.page.close();
  process.stdout.write(
    "draft: sidebar retention, hidden UI, modal resume, consumed submission and explicit source replacement passed\n",
  );
} finally {
  await browser.close();
}
