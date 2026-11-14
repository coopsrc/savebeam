// Local fixture IPC only; no real site requests, media downloads or user Cookie reads.
/* global window, document, structuredClone, getComputedStyle */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";
async function fixture(page, scenario) {
  await page.addInitScript(
    ({ scenario }) => {
      window.isTauri = true;
      const entries = Array.from({ length: scenario === "bounded" ? 65 : 17 }, (_, index) => ({
        id: `BVfixture${index + 1}`,
        index: index + 1,
        title:
          scenario === "cached" ? `视频 ${index + 1}：1973 年跑车修复的真实长标题` : "未命名视频",
        durationSeconds: scenario === "cached" ? 123 : null,
        downloaded: false,
        isNew: false,
        available: true,
        taskStatus: null,
      }));
      window.fixture = {
        calls: [],
        rows: [
          {
            id: 1,
            url: "https://example.invalid/series",
            sourceId: "fixture:list",
            title: "修复系列",
            lastCheckedUnixMs: 1,
            truncated: false,
            entries,
          },
        ],
        hold: scenario === "hidden" || scenario === "stop",
        releases: [],
        fail: scenario === "error",
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          window.fixture.calls.push({ command, args: structuredClone(args) });
          if (command === "list_subscriptions") return structuredClone(window.fixture.rows);
          if (command === "get_subscription_candidates" || command === "get_download_tasks")
            return [];
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
          if (command === "inspect_subscription_entries") {
            if (window.fixture.hold)
              await new Promise((resolve) => {
                window.fixture.releases.push(resolve);
                window.fixture.release = () => {
                  window.fixture.hold = false;
                  window.fixture.releases.splice(0).forEach((release) => release());
                };
              });
            if (window.fixture.fail) {
              window.fixture.fail = false;
              throw {
                code: "network_failure",
                message: "测试：读取信息失败，请重试",
                retryable: true,
                diagnostic: "SECRET_DIAGNOSTIC",
              };
            }
            const rows = args.mediaIds.map((id) => {
              const entry = entries.find((entry) => entry.id === id);
              return {
                id,
                index: entry.index,
                title: `视频 ${entry.index}：1973 年跑车修复的真实长标题`,
                durationSeconds: 120 + entry.index,
                error: null,
              };
            });
            for (const row of rows)
              Object.assign(
                entries.find((entry) => entry.id === row.id),
                row,
              );
            return rows;
          }
          if (command === "check_subscription") return;
          return null;
        },
      };
    },
    { scenario },
  );
}
async function count(page) {
  return page.evaluate(
    () => window.fixture.calls.filter((c) => c.command === "inspect_subscription_entries").length,
  );
}
async function endpoints(page, phase) {
  const result = await page.locator(".subscription-entry-scroll").evaluate((root) => {
    const viewport = root.querySelector(".mantine-ScrollArea-viewport");
    const track = root.querySelector('.mantine-ScrollArea-scrollbar[data-orientation="vertical"]');
    const thumb = track?.querySelector(".mantine-ScrollArea-thumb");
    const box = root.getBoundingClientRect(),
      rail = track?.getBoundingClientRect(),
      handle = thumb?.getBoundingClientRect();
    return {
      height: box.height,
      topInset: rail?.top - box.top,
      bottomInset: box.bottom - rail?.bottom,
      thumbTop: handle?.top - rail?.top,
      thumbBottom: rail?.bottom - handle?.bottom,
      radius: thumb && getComputedStyle(thumb).borderRadius,
      trackBackground: track && getComputedStyle(track).backgroundColor,
      max: viewport.scrollHeight - viewport.clientHeight,
      top: viewport.scrollTop,
    };
  });
  assert.ok(result.height <= 321 && result.max > 0, JSON.stringify(result));
  assert.ok(result.topInset >= 5 && result.bottomInset >= 5, JSON.stringify(result));
  assert.equal(result.radius, "999px");
  assert.equal(result.trackBackground, "rgba(0, 0, 0, 0)");
  assert.ok(result.thumbTop >= -1 && result.thumbBottom >= -1, JSON.stringify(result));
  if (phase === "top") assert.ok(result.thumbTop < 3, JSON.stringify(result));
  if (phase === "bottom") assert.ok(result.thumbBottom < 3, JSON.stringify(result));
}
async function scroll(page, value) {
  await page
    .getByRole("region", { name: "修复系列条目", exact: true })
    .evaluate(async (element, value) => {
      element.scrollTop = value;
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)),
      );
    }, value);
}
try {
  for (const scenario of ["fill", "error", "hidden", "stop", "bounded"]) {
    const page = await browser.newPage({ locale: "zh-CN", viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page, scenario);
    await page.goto(`${base}#/subscriptions`);
    const card = page.getByRole("region", { name: "修复系列", exact: true });
    await card.getByRole("button", { name: /展开条目/ }).click();
    if (scenario === "error") {
      await card.getByText("测试：读取信息失败，请重试", { exact: true }).waitFor();
      await card.getByRole("button", { name: "继续 / 重试读取信息", exact: true }).click();
    }
    if (scenario === "hidden" || scenario === "stop") {
      await page.waitForFunction(() => window.fixture.releases.length === 2);
      if (scenario === "hidden") {
        await card.getByRole("checkbox", { name: "第 1 项 · 标题待补全", exact: true }).check();
        await page.getByRole("link", { name: "任务", exact: true }).click();
        await page.getByRole("heading", { name: "任务", exact: true, level: 1 }).waitFor();
      } else await card.getByRole("button", { name: "停止读取信息", exact: true }).click();
      await page.evaluate(() => window.fixture.release());
      await page.waitForFunction(() =>
        window.fixture.rows[0].entries.slice(0, 2).every((e) => e.title.startsWith("视频")),
      );
      await page.waitForTimeout(100);
      assert.equal(await count(page), 2);
      if (scenario === "hidden")
        await page.getByRole("link", { name: "订阅", exact: true }).click();
      else await card.getByRole("button", { name: "继续 / 重试读取信息", exact: true }).click();
    }
    const expected = scenario === "bounded" ? 50 : 17;
    await card
      .getByRole("checkbox", {
        name: `第 ${expected} 项 · 视频 ${expected}：1973 年跑车修复的真实长标题`,
        exact: true,
      })
      .waitFor();
    await card
      .getByRole("button", { name: "停止读取信息", exact: true })
      .waitFor({ state: "hidden" });
    if (scenario === "bounded") {
      assert.equal(await count(page), 50);
      await page.getByRole("link", { name: "任务", exact: true }).click();
      await page.getByRole("heading", { name: "任务", exact: true, level: 1 }).waitFor();
      await page.getByRole("link", { name: "订阅", exact: true }).click();
      await page.getByRole("heading", { name: "订阅", exact: true, level: 1 }).waitFor();
      await page.waitForTimeout(100);
      assert.equal(await count(page), 50);
      await card.getByRole("button", { name: "继续 / 重试读取信息", exact: true }).click();
      await card
        .getByRole("checkbox", {
          name: "第 65 项 · 视频 65：1973 年跑车修复的真实长标题",
          exact: true,
        })
        .waitFor();
      assert.equal(await count(page), 65);
    } else {
      assert.equal(await count(page), scenario === "error" ? 18 : 17);
      await card.getByText(/时长 2:17 · ID：BVfixture17/).waitFor();
      if (scenario === "hidden")
        assert.equal(
          await card
            .getByRole("checkbox", {
              name: "第 1 项 · 视频 1：1973 年跑车修复的真实长标题",
              exact: true,
            })
            .isChecked(),
          true,
        );
    }
    const batches = await page.evaluate(() =>
      window.fixture.calls
        .filter((c) => c.command === "inspect_subscription_entries")
        .map((c) => c.args.mediaIds),
    );
    assert.ok(batches.every((ids) => ids.length === 1));
    assert.equal(await page.getByText("SECRET_DIAGNOSTIC").count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(`PASS metadata ${scenario}\n`);
  }
  for (const platform of ["macOS", "Windows", "Linux"])
    for (const scheme of ["light", "dark"]) {
      const page = await browser.newPage({
        locale: "zh-CN",
        viewport: { width: 1280, height: 800 },
        colorScheme: scheme,
      });
      await fixture(page, "cached");
      await page.goto(`${base}#/subscriptions`);
      await page.getByText(platform, { exact: true }).click();
      const card = page.getByRole("region", { name: "修复系列", exact: true });
      await card.getByRole("button", { name: /展开条目/ }).click();
      await page.getByRole("region", { name: "修复系列条目", exact: true }).waitFor();
      await scroll(page, 0);
      await endpoints(page, "top");
      await page
        .locator(".subscription-entry-scroll")
        .screenshot({ path: `/tmp/savebeam-sub-scroll-${platform}-${scheme}-top.png` });
      await scroll(page, 999999);
      await endpoints(page, "bottom");
      await page
        .locator(".subscription-entry-scroll")
        .screenshot({ path: `/tmp/savebeam-sub-scroll-${platform}-${scheme}-bottom.png` });
      const viewport = page.getByRole("region", { name: "修复系列条目", exact: true });
      await scroll(page, 0);
      await viewport.focus();
      await viewport.press("PageDown");
      await page.waitForFunction(
        () =>
          document.querySelector(".subscription-entry-scroll .mantine-ScrollArea-viewport")
            .scrollTop > 0,
      );
      await scroll(page, 0);
      const thumb = await page
        .locator(".subscription-entry-scroll .mantine-ScrollArea-thumb")
        .boundingBox();
      const track = await page
        .locator(
          '.subscription-entry-scroll .mantine-ScrollArea-scrollbar[data-orientation="vertical"]',
        )
        .boundingBox();
      await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2);
      await page.mouse.down();
      await page.mouse.move(thumb.x + thumb.width / 2, track.y + track.height - 2, { steps: 8 });
      await page.mouse.up();
      await endpoints(page, "bottom");
      assert.equal(await count(page), 0);
      await page.close();
      process.stdout.write(`PASS inset scrollbar ${platform} ${scheme}\n`);
    }
} finally {
  await browser.close();
}
