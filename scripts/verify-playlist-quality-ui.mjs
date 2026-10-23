// Fixture-only integration: never visits a video site or downloads media.
/* global window, structuredClone */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
async function fixture(scenario) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scenario) => {
    window.isTauri = true;
    window.qualityFixture = {
      calls: [],
      scenario,
      fail: scenario === "read-error",
      delay: scenario === "stop" || scenario === "stale" ? 200 : 30,
      queued: [],
    };
    const formats = (index) => {
      const type = (index - 1) % 3;
      const mb = 1024 * 1024;
      const audio = [
        {
          formatId: "a96",
          extension: "m4a",
          audioCodec: "aac",
          videoCodec: null,
          audioBitrateKbps: 96,
          fileSizeBytes: 10 * mb,
        },
      ];
      if (type !== 1)
        audio.push({
          formatId: "a128",
          extension: "m4a",
          audioCodec: "aac",
          videoCodec: null,
          audioBitrateKbps: 128,
          fileSizeBytes: 10 * mb,
        });
      if (type === 0)
        audio.push({
          formatId: "a256",
          extension: "m4a",
          audioCodec: "aac",
          videoCodec: null,
          audioBitrateKbps: 256,
          fileSizeBytes: 20 * mb,
        });
      if (type === 2)
        audio.push({
          formatId: "a192",
          extension: "m4a",
          audioCodec: "aac",
          videoCodec: null,
          audioBitrateKbps: 192,
          fileSizeBytes: 15 * mb,
        });
      const video = (height, rate, bytes) => ({
        formatId: `v${height}`,
        extension: "mp4",
        videoCodec: "avc1",
        audioCodec: null,
        height,
        resolution: `${height === 720 ? 1280 : height === 1080 ? 1920 : 3840}x${height}`,
        videoBitrateKbps: rate,
        fps: height === 2160 ? 59.94 : 29.97,
        fileSizeBytes: bytes * mb,
      });
      return [
        ...audio,
        ...(type === 0
          ? [video(720, 2000, 100), video(1080, 5000, 300), video(2160, 12000, 900)]
          : type === 1
            ? [video(720, 1500, 80)]
            : [video(2160, 8000, 400)]),
      ];
    };
    const match = (item, policy, audioOnly) => {
      const choose = (p) => {
        const a = item.formats
          .filter(
            (f) =>
              f.audioCodec &&
              (!p.audioExtension || f.extension === p.audioExtension) &&
              (!p.audioCodec || f.audioCodec === p.audioCodec) &&
              (!p.maxAudioBitrateKbps || f.audioBitrateKbps <= p.maxAudioBitrateKbps),
          )
          .at(-1);
        const v = item.formats
          .filter(
            (f) =>
              f.videoCodec &&
              (!p.resolutionHeight || f.height === p.resolutionHeight) &&
              (!p.frameRate || Math.abs(f.fps - p.frameRate) <= 0.1) &&
              (!p.videoExtension || f.extension === p.videoExtension) &&
              (!p.videoCodec || (p.videoCodec === "h264" && f.videoCodec === "avc1")) &&
              (!p.maxHeight || f.height <= p.maxHeight) &&
              (!p.maxVideoBitrateKbps || f.videoBitrateKbps <= p.maxVideoBitrateKbps),
          )
          .at(-1);
        return a && (v || audioOnly) ? { a, v } : null;
      };
      const strict = choose(policy);
      const picked = strict ?? (policy.allowExceed ? choose({}) : null);
      return {
        index: item.index,
        id: item.id,
        formatId:
          item.error || !picked
            ? null
            : audioOnly
              ? picked.a.formatId
              : `${picked.v.formatId}+${picked.a.formatId}`,
        mergeContainer: audioOnly ? null : "mp4",
        resolution: picked?.v?.resolution ?? null,
        videoBitrateKbps: picked?.v?.videoBitrateKbps ?? null,
        audioBitrateKbps: picked?.a?.audioBitrateKbps ?? null,
        bytes:
          item.error || !picked || audioOnly
            ? null
            : picked.v.fileSizeBytes + picked.a.fileSizeBytes,
        fallbackUsed: !strict && !!picked,
        error: item.error ?? (picked ? null : "没有符合所选条件的音视频组合"),
      };
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback() {
        return 1;
      },
      unregisterCallback() {},
      async invoke(command, args = {}) {
        const state = window.qualityFixture;
        state.calls.push({ command, args: structuredClone(args) });
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
        if (command === "inspect_media") {
          if (scenario === "pending")
            await new Promise((resolve) => window.setTimeout(resolve, 350));
          state.inspected = true;
          const count =
            scenario === "retention" || scenario.startsWith("multipart")
              ? 17
              : scenario === "stop" || (scenario === "stale" && args.url.endsWith("old"))
                ? 7
                : 3;
          return {
            id: "series",
            title: "系列测试",
            uploader: "作者",
            webpageUrl: args.url,
            thumbnailUrl: null,
            thumbnailDataUrl: null,
            durationSeconds: null,
            formats: [],
            subtitles: [],
            playlist: {
              id: "list",
              title: "系列测试",
              totalCount: count,
              downloadCount: count,
              truncated: false,
              entries: Array.from({ length: count }, (_, i) => ({
                index: i + 1,
                id: scenario.startsWith("multipart") && i === 12 ? "BV1uVy7BCErV" : `BV${i + 1}`,
                title: "标题待补全",
                available: true,
              })),
            },
          };
        }
        if (command === "inspect_playlist_entries") {
          await new Promise((resolve) => window.setTimeout(resolve, state.delay));
          if (state.fail)
            throw { code: "network_failure", message: "条目详情读取失败，可重试", retryable: true };
          return args.items.map((item) => ({
            ...item,
            title: `${args.url.endsWith("old") ? "旧" : "真实"}标题：第 ${item.index} 集`,
            durationSeconds: 100,
            formats: formats(item.index),
            error: null,
            ...(scenario.startsWith("multipart") && item.index === 13
              ? {
                  formats: [],
                  title: "避震特别篇",
                  parts: [1, 2].map((p) => ({
                    index: 13000 + p,
                    id: `BV1uVy7BCErV_p${p}`,
                    title: `分 P ${p} 标题待补全`,
                    durationSeconds: null,
                    formats: [],
                    error: null,
                    part: {
                      sourceUrl: args.url,
                      collectionId: "306979414_6546672",
                      collectionTitle: "系列测试",
                      parentId: "BV1uVy7BCErV",
                      parentIndex: 13,
                      partIndex: p,
                      partCount: 2,
                    },
                  })),
                }
              : {}),
          }));
        }
        if (command === "inspect_playlist_parts") {
          await new Promise((resolve) => window.setTimeout(resolve, 100));
          if (scenario === "multipart-read-error" && !state.partRetried) {
            state.partRetried = true;
            throw { code: "network_failure", message: "分 P 读取失败，请重试", retryable: true };
          }
          return args.parts.map((part) => ({
            index: part.parentIndex * 1000 + part.partIndex,
            id: `${part.parentId}_p${part.partIndex}`,
            title: part.partIndex === 1 ? "避震特别篇 p01 解说版" : "避震特别篇 p02 纯享版",
            durationSeconds: 300 + part.partIndex,
            formats: formats(part.partIndex),
            error: null,
            part,
          }));
        }
        if (command === "match_playlist_quality")
          return args.items.map((item) =>
            match(
              item,
              args.overrides.find((over) => over.index === item.index)?.policy ?? args.policy,
              args.audioOnly,
            ),
          );
        if (command === "start_playlist_download") {
          const request = args.request;
          const selected = request.items
            .map((item) => ({
              item,
              policy:
                request.overrides.find((over) => over.index === item.index)?.policy ??
                request.policy,
            }))
            .map(({ item, policy }) => ({
              item,
              policy,
              match: match(item, policy, request.downloadOptions.audioOnly),
            }));
          state.queued = selected
            .filter((row) => row.match.formatId)
            .map((row) => ({
              index: row.item.index,
              formatId: row.match.formatId,
              policy: row.policy,
              options: request.downloadOptions,
            }));
          if (scenario === "multipart-partial")
            state.queued = state.queued.filter((row) => row.index !== 13002);
          return {
            tasks: state.queued.map((row) => ({
              id: `task-${row.index}`,
              title: `第 ${row.index} 集`,
              url: request.url,
              formatId: row.formatId,
              status: "queued",
              createdAtUnixMs: 1,
            })),
            queuedIndices: state.queued.map((row) => row.index),
            skipped: selected.filter((row) => !row.match.formatId).map((row) => row.item.index),
            error: scenario === "multipart-partial" ? "模拟 P2 入队失败" : null,
          };
        }
        if (command.startsWith("plugin:event|")) return 1;
        return [];
      },
    };
  }, scenario);
  await page.goto(`${base}#/download`);
  await page
    .getByRole("textbox", { name: "视频链接", exact: true })
    .fill(`https://example.invalid/${scenario === "stale" ? "old" : "series"}`);
  await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
  return { page, errors };
}
async function choose(page, region, label, option) {
  await region.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function confirmed(page, count) {
  await page.getByRole("checkbox", { name: `我确认下载匹配的 ${count} 项`, exact: true }).check();
}
try {
  for (const scenario of [
    "profiles",
    "skips",
    "read-error",
    "stop",
    "stale",
    "pending",
    "retention",
    "multipart",
    "multipart-partial",
    "multipart-read-error",
  ]) {
    const { page, errors } = await fixture(scenario);
    if (scenario.startsWith("multipart")) {
      if (scenario === "multipart-read-error") {
        await page.getByText("分 P 读取失败，请重试", { exact: false }).first().waitFor();
        await page.getByRole("button", { name: "重新读取详情", exact: true }).click();
      }
      const p1 = page.getByRole("checkbox", { name: /第 13 项 · P1 · 避震特别篇 p01 解说版/ });
      const p2 = page.getByRole("checkbox", { name: /第 13 项 · P2 · 避震特别篇 p02 纯享版/ });
      await p1.waitFor();
      await p2.waitFor();
      await confirmed(page, 18);
      assert.equal(await p1.isChecked(), true);
      assert.equal(await p2.isChecked(), true);
      await page.getByRole("button", { name: "第 13 项 · P2单独设置", exact: true }).click();
      const dialog = page.getByRole("dialog", {
        name: "第 13 项 · P2 · 单独画质设置",
        exact: true,
      });
      await choose(page, dialog, "分辨率", "720p");
      await dialog.getByRole("button", { name: "应用", exact: true }).click();
      await p1.uncheck();
      await page.getByRole("link", { name: "设置", exact: true }).click();
      await page.getByRole("link", { name: "下载", exact: true }).click();
      assert.equal(await p1.isChecked(), false);
      assert.equal(await p2.isChecked(), true);
      await confirmed(page, 17);
      await page.screenshot({ path: `/tmp/savebeam-${scenario}.png`, fullPage: true });
      await page.getByRole("button", { name: "开始下载", exact: true }).click();
      if (scenario === "multipart-partial") {
        await page.getByRole("status").filter({ hasText: "已加入 16 项" }).waitFor();
        await confirmed(page, 1);
        assert.equal(await p1.isChecked(), false);
        assert.equal(await p2.isChecked(), true);
      } else await page.waitForURL(/#\/tasks$/);
      const request = await page.evaluate(
        () =>
          window.qualityFixture.calls.filter((c) => c.command === "start_playlist_download").at(-1)
            .args.request,
      );
      assert.equal(request.items.length, 17);
      assert.ok(!request.items.some((i) => i.index === 13 || i.index === 13001));
      assert.equal(request.items.find((i) => i.index === 13002).part.partIndex, 2);
      assert.equal(request.overrides.find((o) => o.index === 13002).policy.resolutionHeight, 720);
      assert.deepEqual(errors, []);
      await page.close();
      process.stdout.write(
        `${scenario}: independent P selection, policy, metadata, navigation and partial queue passed\n`,
      );
      continue;
    }
    if (scenario === "pending") {
      await page.getByRole("link", { name: "任务", exact: true }).click();
      await page.waitForFunction(() => window.qualityFixture.inspected);
      assert.equal(await page.getByRole("textbox", { name: "视频链接", exact: true }).count(), 0);
      await page.getByRole("link", { name: "下载", exact: true }).click();
    }
    const policy = page.getByRole("region", { name: "系列画质策略", exact: true });
    await policy.waitFor();
    for (const [label, preferred] of [
      ["视频格式", "MP4"],
      ["视频编码", "HEVC"],
      ["音频格式", "M4A"],
      ["音频编码", "AAC"],
    ]) {
      assert.equal(
        await policy.getByRole("combobox", { name: label, exact: true }).inputValue(),
        `自动推荐（优先 ${preferred}）`,
      );
    }
    if (scenario === "read-error") {
      await page.getByRole("alert").filter({ hasText: "条目详情读取失败" }).waitFor();
      assert.equal(
        await page.getByRole("button", { name: "开始下载", exact: true }).isDisabled(),
        true,
      );
      await page.evaluate(() => {
        window.qualityFixture.fail = false;
      });
      await page.getByRole("button", { name: "重新读取详情", exact: true }).click();
    }
    if (scenario === "stop") {
      await page.getByRole("button", { name: "停止后续读取", exact: true }).click();
      await page.getByRole("button", { name: "重新读取详情", exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.qualityFixture.calls.filter(
              (call) => call.command === "inspect_playlist_entries",
            ).length,
        ),
        1,
      );
      await page.getByRole("button", { name: "重新读取详情", exact: true }).click();
    }
    if (scenario === "stale") {
      await page
        .getByRole("textbox", { name: "视频链接", exact: true })
        .fill("https://example.invalid/new");
      await page.getByRole("button", { name: "解析视频信息", exact: true }).click();
    }
    const count = scenario === "retention" ? 17 : scenario === "stop" ? 7 : 3;
    await confirmed(page, count);
    await page.getByRole("checkbox", { name: /第 1 项 · 真实标题/ }).waitFor();
    assert.equal(await page.getByText(/旧标题/).count(), 0);
    if (scenario === "pending") {
      assert.equal(
        await page.evaluate(
          () =>
            window.qualityFixture.calls.filter((call) => call.command === "inspect_media").length,
        ),
        1,
      );
    }
    if (scenario === "retention") {
      await choose(page, policy, "视频编码", "H.264 / AVC");
      await page.getByRole("button", { name: "第 1 项单独设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "第 1 项 · 单独画质设置", exact: true });
      await choose(page, dialog, "分辨率", "720p");
      await choose(page, dialog, "帧率（FPS）", "30 fps");
      await dialog.getByRole("button", { name: "应用", exact: true }).click();
      await page.getByRole("checkbox", { name: /第 2 项 · 真实标题/ }).uncheck();
      await confirmed(page, 16);
      await page.getByRole("button", { name: "高级设置", exact: true }).click();
      const advanced = page.getByRole("dialog", { name: "高级设置", exact: true });
      await advanced.getByRole("checkbox", { name: "保留中间文件", exact: true }).check();
      await advanced.getByRole("button", { name: "应用到本次下载", exact: true }).click();
      await confirmed(page, 16);
      await page.getByRole("button", { name: "开始下载", exact: true }).scrollIntoViewIfNeeded();
      await page.locator(".download-playlist-list").evaluate((element) => {
        element.scrollTop = 160;
      });
      await page.waitForFunction(
        () => window.document.querySelector(".page-content").scrollTop > 0,
      );
      const before = await page.evaluate(() => ({
        top: window.document.querySelector(".page-content").scrollTop,
        listTop: window.document.querySelector(".download-playlist-list").scrollTop,
        calls: window.qualityFixture.calls.filter((call) =>
          ["inspect_media", "inspect_playlist_entries", "match_playlist_quality"].includes(
            call.command,
          ),
        ).length,
      }));
      for (const route of ["任务", "历史", "设置", "订阅"]) {
        await page.getByRole("link", { name: route, exact: true }).click();
        await page.getByRole("link", { name: "下载", exact: true }).click();
        assert.equal(
          await page.getByRole("combobox", { name: "视频编码", exact: true }).inputValue(),
          "H.264 / AVC",
        );
        assert.equal(
          await page.getByRole("checkbox", { name: /第 2 项 · 真实标题/ }).isChecked(),
          false,
        );
        assert.equal(
          await page
            .getByRole("checkbox", { name: "我确认下载匹配的 16 项", exact: true })
            .isChecked(),
          true,
        );
        const scroll = await page.evaluate(() => ({
          top: window.document.querySelector(".page-content").scrollTop,
          listTop: window.document.querySelector(".download-playlist-list").scrollTop,
        }));
        assert.ok(
          Math.abs(scroll.top - before.top) <= 1,
          "Download page scroll position is restored",
        );
        assert.equal(
          scroll.listTop,
          before.listTop,
          "Series inner scroll position survives navigation",
        );
      }
      assert.equal(
        await page.evaluate(
          () =>
            window.qualityFixture.calls.filter((call) =>
              ["inspect_media", "inspect_playlist_entries", "match_playlist_quality"].includes(
                call.command,
              ),
            ).length,
        ),
        before.calls,
        "returning uses the same details and matching cache",
      );
      await page.screenshot({ path: "/tmp/savebeam-download-draft-restored.png" });
      await page.getByRole("button", { name: "开始下载", exact: true }).click();
      await page.waitForURL(/#\/tasks$/);
      const queued = await page.evaluate(() => window.qualityFixture.queued);
      assert.equal(queued.length, 16);
      assert.equal(queued[0].formatId, "v720+a256");
      assert.equal(queued[0].policy.frameRate, 30);
      assert.equal(queued[0].options.keepIntermediateFiles, true);
      assert.equal(
        queued.some((row) => row.index === 2),
        false,
      );
      await page.getByRole("link", { name: "下载", exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: "视频链接", exact: true }).inputValue(),
        "",
      );
    }
    if (scenario === "profiles" || scenario === "skips") {
      const calls = await page.evaluate(
        () =>
          window.qualityFixture.calls.filter((call) => call.command === "inspect_playlist_entries")
            .length,
      );
      if (scenario === "profiles") {
        await choose(page, policy, "视频编码", "VP9");
        await page.getByText("没有符合所选条件的音视频组合", { exact: true }).first().waitFor();
        assert.equal(
          await page.getByRole("button", { name: "开始下载", exact: true }).isDisabled(),
          true,
        );
        await policy.getByRole("button", { name: "视频恢复默认", exact: true }).click();
        await confirmed(page, 3);
        await choose(page, policy, "音频编码", "OPUS");
        await page.getByText("没有符合所选条件的音视频组合", { exact: true }).first().waitFor();
        await policy.getByRole("button", { name: "音频恢复默认", exact: true }).click();
        await confirmed(page, 3);
      }
      await choose(page, policy, "分辨率", "720p");
      await choose(page, policy, "帧率（FPS）", "30 fps");
      await choose(page, policy, "视频格式", "mp4");
      await choose(page, policy, "视频编码", "H.264 / AVC");
      await choose(page, policy, "音频格式", "m4a");
      await choose(page, policy, "音频编码", "AAC");
      await choose(page, policy, "音频码率", "≤ 128 kbps");
      await confirmed(page, 2);
      const first = page.locator(".download-playlist-row").filter({ hasText: "第 1 项" });
      await first.getByText(/1280x720.*2000 kbps.*128 kbps.*110.0 MB/).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            window.qualityFixture.calls.filter(
              (call) => call.command === "inspect_playlist_entries",
            ).length,
        ),
        calls,
        "policy changes use cached formats, not more network requests",
      );
      if (scenario === "profiles") {
        await policy.getByRole("checkbox", { name: "无匹配时允许回退 Best", exact: true }).check();
        await confirmed(page, 3);
        await page
          .getByText(/已回退 Best/, { exact: false })
          .last()
          .waitFor();
        await policy
          .getByRole("checkbox", { name: "无匹配时允许回退 Best", exact: true })
          .uncheck();
        await page.getByRole("button", { name: "第 3 项单独设置", exact: true }).click();
        let dialog = page.getByRole("dialog", { name: "第 3 项 · 单独画质设置", exact: true });
        await choose(page, dialog, "分辨率", "2160p");
        await dialog.getByRole("button", { name: "取消", exact: true }).click();
        await confirmed(page, 2);
        await page.getByRole("button", { name: "第 3 项单独设置", exact: true }).click();
        dialog = page.getByRole("dialog", { name: "第 3 项 · 单独画质设置", exact: true });
        await dialog.getByRole("button", { name: "视频恢复默认", exact: true }).click();
        await dialog
          .getByRole("combobox", { name: "帧率（FPS）", exact: true })
          .and(page.locator('input[value="Best（最佳可用）"]'))
          .waitFor();
        assert.equal(
          await dialog.getByRole("combobox", { name: "帧率（FPS）", exact: true }).inputValue(),
          "Best（最佳可用）",
        );
        await choose(page, dialog, "分辨率", "2160p");
        await choose(page, dialog, "帧率（FPS）", "60 fps");
        await choose(page, dialog, "视频编码", "H.264 / AVC");
        await choose(page, dialog, "音频码率", "≤ 192 kbps");
        await dialog.screenshot({ path: "/tmp/savebeam-playlist-track-modal.png" });
        await dialog.getByRole("button", { name: "应用", exact: true }).click();
        await confirmed(page, 3);
        await page.getByText(/单独策略/).waitFor();
        await page
          .locator(".download-playlist-row")
          .filter({ hasText: "第 3 项" })
          .getByText(/59.94 fps.*mp4.*H.264.*192 kbps/)
          .waitFor();
        const source = await page
          .getByRole("region", { name: "媒体与格式", exact: true })
          .boundingBox();
        const quality = await policy.boundingBox();
        const list = await page
          .getByRole("region", { name: "选择系列视频", exact: true })
          .boundingBox();
        assert.ok(source.height < quality.height && quality.y >= source.y + source.height + 12);
        assert.ok(
          Math.abs(source.y - list.y) <= 1 &&
            Math.abs(quality.y + quality.height - list.y - list.height) <= 1,
        );
        await page.setViewportSize({ width: 1600, height: 1100 });
        await page.screenshot({ path: "/tmp/savebeam-playlist-quality.png" });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.getByRole("button", { name: "开始下载", exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: "/tmp/savebeam-playlist-quality-1280x800.png" });
      }
      await page.getByRole("button", { name: "开始下载", exact: true }).click();
      if (scenario === "profiles") await page.waitForURL(/#\/tasks$/);
      else await page.getByRole("status").filter({ hasText: "已加入 2 项" }).waitFor();
      const queued = await page.evaluate(() => window.qualityFixture.queued);
      assert.equal(queued.length, scenario === "profiles" ? 3 : 2);
      assert.equal(queued[0].formatId, "v720+a128");
      assert.equal(queued[0].policy.resolutionHeight, 720);
      assert.equal(queued[0].policy.automaticRecommendations, true);
      assert.equal(queued[0].policy.frameRate, 30);
      assert.equal(queued[0].policy.videoExtension, "mp4");
      assert.equal(queued[0].policy.videoCodec, "h264");
      assert.equal(queued[0].policy.audioExtension, "m4a");
      assert.equal(queued[0].policy.audioCodec, "aac");
      if (scenario === "profiles") {
        assert.equal(queued[2].formatId, "v2160+a192");
        assert.equal(queued[2].policy.resolutionHeight, 2160);
        assert.equal(queued[2].policy.frameRate, 60);
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      `${scenario}: title hydration, strategy, per-row sizing and safe task creation passed\n`,
    );
  }
} finally {
  await browser.close();
}
