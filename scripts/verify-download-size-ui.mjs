// Fixture-only size display regression: no websites, media or cookies are accessed.
/* global window, document, console */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
try {
  for (const series of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
    await page.addInitScript((series) => {
      window.calls = [];
      window.isTauri = true;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          window.calls.push({ command, args });
          if (command === "inspect_media")
            return {
              id: "media",
              title: "测试媒体",
              webpageUrl: "https://example.invalid/series",
              uploader: "作者",
              durationSeconds: 100,
              thumbnailUrl: null,
              thumbnailDataUrl: null,
              subtitles: [],
              formats: series
                ? []
                : [
                    {
                      formatId: "video",
                      extension: "mp4",
                      videoCodec: "avc1",
                      audioCodec: null,
                      resolution: "1920x1080",
                      fileSizeBytes: 1048576,
                    },
                    {
                      formatId: "audio",
                      extension: "m4a",
                      videoCodec: null,
                      audioCodec: "aac",
                      audioBitrateKbps: 128,
                      fileSizeBytes: 1048576,
                    },
                    {
                      formatId: "audio2",
                      extension: "m4a",
                      videoCodec: null,
                      audioCodec: "aac",
                      audioBitrateKbps: 192,
                      fileSizeBytes: 2097152,
                    },
                  ],
              playlist: series
                ? {
                    id: "series",
                    title: "系列",
                    totalCount: 2,
                    downloadCount: 2,
                    truncated: false,
                    entries: [
                      { index: 2, id: "two", title: "第二集", available: true },
                      { index: 9, id: "nine", title: "第九集", available: true },
                    ],
                  }
                : null,
            };
          if (command === "estimate_playlist_size") {
            if (window.failEstimate)
              throw { code: "network_failure", message: "估算连接失败", retryable: true };
            return args.items.map((item) => ({
              ...item,
              bytes: window.partial && item.index === 9 ? null : 1048576,
            }));
          }
          if (command.startsWith("plugin:event|")) return 1;
          return [];
        },
      };
    }, series);
    await page.goto(`${process.argv[3] ?? "http://127.0.0.1:1421/"}#/download`);
    await page
      .getByRole("textbox", { name: "视频链接", exact: true })
      .fill("https://example.invalid/series");
    await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
    const hint = page.locator(".download-size-hint");
    await hint.waitFor();
    const text = async (value) => {
      await page.waitForFunction(
        (value) => document.querySelector(".download-size-hint")?.textContent.includes(value),
        value,
      );
    };
    if (series) {
      assert.equal(
        await page.evaluate(
          () => window.calls.filter((call) => call.command === "estimate_playlist_size").length,
        ),
        0,
      );
      await page.evaluate(() => {
        window.partial = true;
      });
      await page.getByRole("button", { name: "估算大小", exact: true }).click();
      await text("已知大小：约 1.0 MB，1 项待估算");
      assert.deepEqual(
        await page.evaluate(() =>
          window.calls
            .find((call) => call.command === "estimate_playlist_size")
            .args.items.map((item) => item.index),
        ),
        [2, 9],
      );
      await page.evaluate(() => {
        window.partial = false;
      });
      await page.getByRole("button", { name: "重新估算", exact: true }).click();
      await text("所选 2 项合计：约 2.0 MB");
      await page.getByRole("checkbox", { name: /第 9 项/ }).uncheck();
      await text("所选 1 项合计：约 1.0 MB");
      await page.evaluate(() => {
        window.failEstimate = true;
      });
      await page.getByRole("button", { name: "重新估算", exact: true }).click();
      await page.getByRole("alert").waitFor();
    } else {
      await text("预计文件大小：约 3.0 MB");
      await page.getByRole("checkbox", { name: "手动选择音频", exact: true }).check();
      await page.getByRole("combobox", { name: "音频轨道", exact: true }).click();
      await page.getByRole("option", { name: /#audio（兼容推荐）/ }).click();
      await text("预计文件大小：约 2.0 MB");
    }
    await page.getByRole("checkbox", { name: "仅下载音频（MP3）", exact: true }).check();
    await text("MP3 转换后待定");
    assert.equal(await page.getByRole("region", { name: "预计输出", exact: true }).count(), 0);
    await page.screenshot({
      path: `/tmp/savebeam-size-${series ? "series" : "single"}.png`,
      fullPage: true,
    });
    await page.close();
  }
  console.log(
    "PASS: single track selection, series sparse/partial/complete totals, retry errors and MP3 uncertainty",
  );
} finally {
  await browser.close();
}
