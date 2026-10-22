// Fixture-only UI regression. No website, media downloads, or Cookie access.
/* global window, structuredClone */
// node scripts/verify-download-layout-ui.mjs <playwright/index.mjs> [baseURL]
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
  id: "BVfixture",
  title: "长标题测试：视频、音频与系列下载界面，包含足够长的文字以验证自动换行",
  webpageUrl: "https://example.invalid/series",
  thumbnailUrl: null,
  thumbnailDataUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="81"><rect width="144" height="81" rx="6" fill="#dbeafe"/><path d="M62 24L86 40L62 57Z" fill="#2563eb"/></svg>')}`,
  uploader: "测试 UP 主",
  durationSeconds: 300,
  subtitles: [],
  formats: [
    {
      formatId: "140",
      extension: "m4a",
      videoCodec: null,
      audioCodec: "aac",
      resolution: null,
      fps: null,
      language: null,
      formatNote: null,
      audioBitrateKbps: 128,
      fileSizeBytes: 1024,
      approximateFileSizeBytes: null,
    },
    {
      formatId: "137",
      extension: "mp4",
      videoCodec: "avc1",
      audioCodec: null,
      resolution: "1920x1080",
      fps: 30,
      language: null,
      formatNote: null,
      audioBitrateKbps: null,
      fileSizeBytes: 1048576,
      approximateFileSizeBytes: null,
    },
  ],
  playlist: null,
};

async function assertAlignedPanels(page, width, seriesMode) {
  // Allow React's responsive navigation profile to catch up after viewport resize.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
      ),
  );
  await page.locator(".app-sidebar").evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  const source = await page.getByRole("region", { name: "媒体与格式", exact: true }).boundingBox();
  const options = await page.getByRole("region", { name: "下载选项", exact: true }).boundingBox();
  const actions = page.getByRole("group", { name: "下载操作", exact: true });
  const footer = await actions.boundingBox();
  const button = await actions.getByRole("button", { name: "开始下载", exact: true }).boundingBox();
  assert.equal(
    await page
      .getByRole("region", { name: "下载选项", exact: true })
      .getByRole("button", { name: "开始下载", exact: true })
      .count(),
    0,
    "Start is outside the options card",
  );
  assert.ok(footer.y >= options.y + options.height + 12, "Start footer follows both panels");
  assert.ok(
    Math.abs(button.x + button.width - footer.x - footer.width) <= 1,
    "Start is right-aligned",
  );
  let edge = options;
  if (seriesMode) {
    const series = await page
      .getByRole("region", { name: "选择系列视频", exact: true })
      .boundingBox();
    if (width >= 1200) {
      assert.ok(Math.abs(series.y - source.y) <= 1, "List top aligns with media top");
      assert.ok(
        Math.abs(series.y + series.height - options.y - options.height) <= 1,
        JSON.stringify({ source, series, options }),
      );
      edge = series;
    }
    assert.ok(footer.y >= series.y + series.height + 12, "Start is below the list, not inside it");
    const content = await page.locator(".download-series-content").boundingBox();
    assert.ok(
      content.y + content.height <= series.y + series.height + 1,
      "Controls fit inside the list card",
    );
  }
  assert.ok(
    Math.abs(button.x + button.width - edge.x - edge.width) <= 1,
    `Start aligns with the outer content right edge: ${JSON.stringify({ width, button, edge })}`,
  );
}

try {
  for (const mode of ["series", "single"]) {
    for (const width of [1600, 1280, 1200, 1199, 1100, 800, 560]) {
      const page = await browser.newPage({ viewport: { width, height: 960 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const media = structuredClone(fixture);
      if (mode === "series") {
        media.formats = [];
        media.playlist = {
          id: "306979414_6546672",
          title: "1973年修复合集，长名称与独立视频 ID 测试",
          totalCount: 17,
          downloadCount: 17,
          truncated: false,
          entries: Array.from({ length: 17 }, (_, index) => ({
            index: index + 1,
            id: `BVtest${index + 1}`,
            title: `${index + 1} 课：足够长的视频名称，用于验证列表行高不会被压缩或彼此重叠`,
            available: true,
          })),
        };
      }
      await page.addInitScript((media) => {
        window.isTauri = true;
        window.layoutMedia = media;
        window.calls = [];
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        window.__TAURI_INTERNALS__ = {
          transformCallback() {
            return 1;
          },
          unregisterCallback() {},
          async invoke(command, args = {}) {
            window.calls.push({ command, args });
            if (command === "inspect_media") return window.layoutMedia;
            if (command === "start_download")
              return {
                id: "layout-task",
                title: media.title,
                url: media.webpageUrl,
                formatId: args.options.formatId,
                status: "queued",
                createdAtUnixMs: 1000,
              };
            if (command.startsWith("plugin:event|")) return 1;
            return [];
          },
        };
      }, media);
      await page.goto(`${base}#/download`);
      await page.getByRole("textbox", { name: "视频链接", exact: true }).fill(media.webpageUrl);
      await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
      await page.getByRole("region", { name: "媒体与格式", exact: true }).waitFor();
      assert.equal(await page.getByRole("region", { name: "预计输出", exact: true }).count(), 0);
      assert.equal(await page.getByText(/预计文件名|预计文件大小/).count(), 0);
      if (mode === "series") {
        const list = page.locator(".download-playlist-list");
        const geometry = await list.evaluate((element) => ({
          height: element.clientHeight,
          scroll: element.scrollHeight,
          rows: Array.from(element.children).map((row) => {
            const rect = row.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: rect.height };
          }),
        }));
        assert.equal(geometry.rows.length, 17);
        assert.ok(geometry.scroll > geometry.height, JSON.stringify(geometry));
        assert.ok(
          geometry.rows.every((row) => row.height >= 20),
          JSON.stringify(geometry),
        );
        for (let index = 1; index < geometry.rows.length; index++)
          assert.ok(
            geometry.rows[index].top >= geometry.rows[index - 1].bottom - 0.5,
            "Video rows overlap",
          );
        const following = await list.evaluate((element) => ({
          listBottom: element.getBoundingClientRect().bottom,
          nextTop: element.nextElementSibling.getBoundingClientRect().top,
        }));
        assert.ok(following.nextTop >= following.listBottom - 0.5, "List overlaps confirmation");
        await list.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        const last = await list.evaluate((element) => ({
          listBottom: element.getBoundingClientRect().bottom,
          rowBottom: element.lastElementChild.getBoundingClientRect().bottom,
        }));
        assert.ok(last.rowBottom <= last.listBottom + 1, "Last video cannot be scrolled into view");
        await list.evaluate((element) => {
          element.scrollTop = 0;
        });
      }
      const source = await page
        .getByRole("region", { name: "媒体与格式", exact: true })
        .boundingBox();
      const options = await page
        .getByRole("region", { name: "下载选项", exact: true })
        .boundingBox();
      const details = await page.locator(".download-media-details").boundingBox();
      const thumbnail = await page
        .getByRole("img", { name: "视频封面", exact: true })
        .boundingBox();
      assert.ok(
        details.width >= Math.min(180, source.width - 32),
        JSON.stringify({ source, details }),
      );
      assert.ok(
        details.x + details.width <= source.x + source.width + 1,
        "Media title escapes its panel",
      );
      assert.ok(thumbnail.width <= 160 && thumbnail.height <= 100, JSON.stringify(thumbnail));
      assert.ok(options.y >= source.y + source.height + 12, JSON.stringify({ source, options }));
      assert.ok(Math.abs(options.x - source.x) <= 1, "Options must stay below media");
      if (mode === "series") {
        const series = await page
          .getByRole("region", { name: "选择系列视频", exact: true })
          .boundingBox();
        if (width >= 1200) {
          assert.ok(series.x >= source.x + source.width + 12, JSON.stringify({ source, series }));
          assert.ok(Math.abs(series.y - source.y) <= 1);
        } else {
          assert.ok(series.y >= source.y + source.height + 12);
          assert.ok(options.y >= series.y + series.height + 12, "Start follows video list");
        }
      } else {
        assert.equal(
          await page.getByRole("region", { name: "选择系列视频", exact: true }).count(),
          0,
        );
        const card = await page.locator(".download-card").boundingBox();
        assert.ok(card.width <= 821, "Single video remains compact even on wide windows");
      }
      const overflow = await page
        .locator(".page-content")
        .evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
      assert.ok(overflow.scroll <= overflow.client + 1, JSON.stringify({ width, overflow }));
      await assertAlignedPanels(page, width, mode === "series");
      if (mode === "single") {
        await page.getByRole("checkbox", { name: "手动选择音频", exact: true }).check();
        await page.getByRole("combobox", { name: "音频轨道", exact: true }).waitFor();
      }
      if (width === 1600 || width === 560) {
        await page.locator(".page-content").evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.screenshot({ path: `/tmp/savebeam-download-${mode}-${width}.png` });
        if (width === 1600) {
          await page
            .getByRole("button", { name: "开始下载", exact: true })
            .scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/savebeam-download-${mode}-${width}-controls.png` });
        }
      }
      const mp3 = width === 800;
      if (mp3) {
        if (mode === "series")
          await page.getByRole("checkbox", { name: "我确认下载所选 17 项", exact: true }).check();
        await page.getByRole("checkbox", { name: "仅下载音频（MP3）", exact: true }).check();
        if (mode === "series")
          assert.equal(
            await page
              .getByRole("checkbox", { name: "我确认下载所选 17 项", exact: true })
              .isChecked(),
            false,
          );
        else {
          assert.equal(
            await page.getByRole("checkbox", { name: "手动选择音频", exact: true }).isChecked(),
            false,
          );
          assert.equal(
            await page.getByRole("combobox", { name: "视频画质", exact: true }).count(),
            0,
          );
        }
      }
      await page.getByRole("checkbox", { name: "保留中间文件", exact: true }).check();
      let indices = null;
      if (mode === "series") {
        assert.equal(
          await page.getByRole("button", { name: "开始下载", exact: true }).isDisabled(),
          true,
        );
        await page.getByRole("button", { name: "取消全选", exact: true }).click();
        assert.equal(
          await page
            .getByRole("checkbox", { name: "我确认下载所选 0 项", exact: true })
            .isDisabled(),
          true,
        );
        await page.getByRole("button", { name: "全选", exact: true }).click();
        await page.getByRole("checkbox", { name: "我确认下载所选 17 项", exact: true }).check();
        await page.getByRole("checkbox", { name: /第 2 项 ·/ }).uncheck();
        assert.equal(
          await page
            .getByRole("checkbox", { name: "我确认下载所选 16 项", exact: true })
            .isChecked(),
          false,
        );
        await page.getByRole("checkbox", { name: "我确认下载所选 16 项", exact: true }).check();
        indices = media.playlist.entries
          .filter((entry) => entry.index !== 2)
          .map((entry) => entry.index);
      }
      await page.getByRole("button", { name: "开始下载", exact: true }).click();
      await page.getByRole("region", { name: `任务：${media.title}`, exact: true }).waitFor();
      const calls = await page.evaluate(() =>
        window.calls.filter((call) => call.command === "start_download"),
      );
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args.options.playlistItems, indices);
      assert.equal(calls[0].args.options.audioOnly, mp3);
      assert.equal(calls[0].args.options.keepIntermediateFiles, true);
      if (mode === "single") {
        assert.equal(calls[0].args.options.formatId, mp3 ? "140" : "137+140");
        assert.equal(calls[0].args.options.mergeContainer, mp3 ? null : "mp4");
      }
      assert.equal(
        await page.evaluate(
          () => window.calls.filter((call) => call.command === "inspect_media").length,
        ),
        1,
      );
      assert.deepEqual(errors, []);
      process.stdout.write(`${mode} ${width}: passed\n`);
      if (mode === "series" && width === 1600) {
        // Left content controls the height for empty, short and 50-item lists too.
        for (const count of [0, 1, 50]) {
          const variant = structuredClone(media);
          variant.playlist.entries = Array.from({ length: count }, (_, index) => ({
            index: index + 1,
            id: `BVstress${index + 1}`,
            title: `第 ${index + 1} 个视频：自然行高和独立滚动测试`,
            available: true,
          }));
          variant.playlist.totalCount = count;
          variant.playlist.downloadCount = count;
          if (count === 50) {
            variant.title = fixture.title.repeat(4);
            variant.subtitles = [
              { language: "zh-Hans", name: "中文", extension: "vtt", automatic: true },
            ];
          }
          await page.evaluate((value) => {
            window.layoutMedia = value;
          }, variant);
          await page.goto(`${base}#/download`);
          await page.getByRole("textbox", { name: "视频链接", exact: true }).fill(media.webpageUrl);
          await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
          await page.getByText(`选择下载条目（已选 ${count} 项）`, { exact: true }).waitFor();
          if (count === 50) {
            const subtitles = page.getByRole("combobox", { name: "下载字幕", exact: true });
            await subtitles.click();
            await page.getByRole("option", { name: "zh-Hans — 中文", exact: true }).click();
            await subtitles.press("Escape");
            await page
              .getByRole("checkbox", { name: "同时下载自动生成的字幕", exact: true })
              .waitFor();
          }
          await assertAlignedPanels(page, 1600, true);
          await page.setViewportSize({ width: 1200, height: 600 });
          await assertAlignedPanels(page, 1200, true);
          await page.setViewportSize({ width: 800, height: 600 });
          await assertAlignedPanels(page, 800, true);
          await page.setViewportSize({ width: 1600, height: 960 });
          await assertAlignedPanels(page, 1600, true);
          assert.equal(
            await page.getByRole("button", { name: "开始下载", exact: true }).isDisabled(),
            true,
          );
          assert.deepEqual(errors, []);
          process.stdout.write(`series ${count} items, resize 1600/1200/800/1600: passed\n`);
        }
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}
