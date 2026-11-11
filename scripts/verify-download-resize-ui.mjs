// Fixture-only regression, including WebKit (the macOS Tauri rendering engine).
/* global window, document */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const engines = await import(pathToFileURL(process.argv[2]).href);
const engine = process.argv[4] ?? "chromium";
const browser = await engines[engine].launch(
  engine === "chromium"
    ? {
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        headless: true,
      }
    : { headless: true },
);
try {
  for (const mode of ["collection", "multipart"]) {
    for (const locale of ["zh-CN", "en-US"]) {
      const en = locale === "en-US";
      const page = await browser.newPage({
        locale,
        viewport: { width: 1600, height: 960 },
        colorScheme: en ? "dark" : "light",
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(
        ({ mode }) => {
          window.isTauri = true;
          const formats = [
            {
              formatId: "v",
              extension: "mp4",
              resolution: "1920x1080",
              height: 1080,
              fps: 30,
              videoCodec: "hevc",
              audioCodec: null,
              videoBitrateKbps: 2000,
              fileSizeBytes: 1000000,
            },
            {
              formatId: "a",
              extension: "m4a",
              videoCodec: null,
              audioCodec: "aac",
              audioBitrateKbps: 128,
              fileSizeBytes: 10000,
            },
          ];
          const count = mode === "collection" ? 17 : 20;
          const title = "1973年修复合集：长标题用于验证窗口缩放以及详情补全时的自然换行和独立滚动";
          const media = {
            id: "parent",
            mediaType: mode,
            title,
            webpageUrl: "https://example.invalid/list",
            thumbnailUrl: null,
            thumbnailDataUrl: null,
            uploader: "测试作者",
            durationSeconds: null,
            formats: [],
            subtitles: [],
            playlist: {
              id: "list",
              title,
              totalCount: count,
              downloadCount: count,
              truncated: false,
              entries: Array.from({ length: count }, (_, i) => ({
                index: i + 1,
                id: "id" + (i + 1),
                title: "标题待补全",
                available: true,
              })),
            },
          };
          window.calls = [];
          window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
          window.__TAURI_INTERNALS__ = {
            transformCallback() {
              return 1;
            },
            unregisterCallback() {},
            async invoke(command, args = {}) {
              window.calls.push({ command, args });
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
              if (command === "inspect_media") return media;
              if (command === "inspect_playlist_entries") {
                await new Promise((resolve) => window.setTimeout(resolve, 100));
                return args.items.map((item) => ({
                  ...item,
                  title:
                    (mode === "multipart" ? "P" + item.index + " · " : "") +
                    "老车修复第 " +
                    item.index +
                    " 期：足够长的视频条目标题，需要在列表中占据多行；详细规格、视频 ID 和时长也不能覆盖相邻条目。",
                  durationSeconds: 545,
                  formats,
                  subtitles: [],
                  error: null,
                }));
              }
              if (command === "match_playlist_quality")
                return args.items.map((item) => ({
                  index: item.index,
                  id: item.id,
                  formatId: item.index === 3 ? null : "v+a",
                  resolution: "1920x1080",
                  mergeContainer: "mp4",
                  videoBitrateKbps: 2000,
                  audioBitrateKbps: 128,
                  bytes: 1010000,
                  fallbackUsed: false,
                  error: item.index === 3 ? "测试：无匹配格式，可单独设置或取消勾选。" : null,
                }));
              return [];
            },
          };
        },
        { mode },
      );
      await page.goto((process.argv[3] ?? "http://127.0.0.1:1421/") + "#/download");
      await page
        .getByRole("textbox", { name: en ? "Video URL" : "视频链接", exact: true })
        .fill("https://example.invalid/list");
      await page
        .getByRole("button", { name: en ? "Analyze video" : "解析视频信息", exact: true })
        .click();
      await page.locator(".download-series-panel").waitFor();
      const check = async (width) => {
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
            ),
        );
        const state = await page.evaluate(() => {
          const panel = document.querySelector(".download-series-panel");
          const content = panel.querySelector(".download-series-content");
          const list = panel.querySelector(".download-playlist-list");
          const confirmation = content.lastElementChild;
          const source = document.querySelector(".download-source-panel");
          const quality = document.querySelector(".download-quality-panel");
          const actions = document.querySelector(".download-start-actions");
          const rect = (e) => {
            const r = e.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, right: r.right };
          };
          const viewport = document.querySelector(".page-content");
          return {
            panel: rect(panel),
            content: rect(content),
            list: rect(list),
            confirmation: rect(confirmation),
            source: rect(source),
            quality: rect(quality),
            actions: rect(actions),
            client: list.clientHeight,
            scroll: list.scrollHeight,
            horizontal: viewport.scrollWidth - viewport.clientWidth,
          };
        });
        const info = JSON.stringify({ engine, mode, locale, width, state });
        assert.ok(
          state.list.top >= state.panel.top && state.list.bottom <= state.panel.bottom - 12,
          info,
        );
        assert.ok(state.content.bottom <= state.panel.bottom - 12, info);
        assert.ok(
          state.confirmation.top >= state.list.bottom - 1 &&
            state.confirmation.bottom <= state.panel.bottom - 12,
          info,
        );
        assert.ok(state.client > 16 && state.scroll > state.client, info);
        assert.ok(state.actions.top >= state.panel.bottom + 12, info);
        assert.ok(state.horizontal <= 1, info);
        if (width >= 1200) {
          assert.ok(Math.abs(state.panel.top - state.source.top) <= 1, info);
          assert.ok(Math.abs(state.panel.bottom - state.quality.bottom) <= 1, info);
        }
      };
      for (const width of [1600, 1280, 1200, 1199, 1440, 1280]) {
        await page.setViewportSize({ width, height: width < 1280 ? 720 : 800 });
        await check(width);
      }
      await page.waitForFunction(
        () => window.calls.filter((c) => c.command === "inspect_playlist_entries").length >= 4,
      );
      await page.waitForTimeout(200);
      await check(1280);
      // Collapse/expand changes the left column height as well as the scroll viewport.
      const toggle = page.locator(".download-quality-panel").getByRole("button", {
        name: en ? "Expand quality settings" : "展开画质设置",
        exact: true,
      });
      await toggle.click();
      await check(1280);
      await page
        .locator(".download-quality-panel")
        .getByRole("button", {
          name: en ? "Collapse quality settings" : "收起画质设置",
          exact: true,
        })
        .click();
      await check(1280);
      const list = page.locator(".download-series-panel .download-playlist-list");
      await page.waitForTimeout(250);
      await check(1280);
      await list.evaluate((el) => (el.scrollTop = el.scrollHeight));
      assert.ok(await list.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 2));
      assert.ok(
        await list.evaluate((el) => {
          const end = el.lastElementChild.getBoundingClientRect();
          const viewport = el.getBoundingClientRect();
          return end.bottom <= viewport.bottom + 1 && end.bottom > viewport.top;
        }),
      );
      await page.locator(".download-start-actions").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/savebeam-resize-${engine}-${mode}-${locale}.png` });
      assert.deepEqual(errors, []);
      await page.close();
      process.stdout.write(
        `${engine} ${mode} ${locale}: resize/hydration/quality-toggle/scroll containment passed\n`,
      );
    }
  }
} finally {
  await browser.close();
}
