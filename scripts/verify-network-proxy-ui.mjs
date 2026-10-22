// Fixture-only settings UI. No external networking or real proxy settings are changed.
/* global window */
import assert from "node:assert/strict";
import process from "node:process";
import { pathToFileURL } from "node:url";
if (!process.argv[2]) throw new Error("Pass the installed Playwright module path.");
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const base = process.argv[3] ?? "http://127.0.0.1:1421/";

async function fixture({ failLoad = false, failSave = false, delay = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (options) => {
      window.isTauri = true;
      window.proxyFixture = {
        ...options,
        preferences: { proxyMode: "default", proxyUrl: "" },
        calls: [],
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command, args = {}) {
          const state = window.proxyFixture;
          state.calls.push({ command, args });
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
          if (command === "get_network_preferences") {
            if (state.failLoad) throw { code: "unknown", message: "读取失败", retryable: true };
            return state.preferences;
          }
          if (command === "test_network_connection") {
            await new Promise((resolve) => window.setTimeout(resolve, 180));
            if (state.failTest)
              throw {
                code: "network_failure",
                message: "连接测试暂不可用，请重试。",
                retryable: true,
              };
            const kind = state.testKind ?? "success";
            return {
              proxy: {
                status:
                  args.preferences.proxyMode === "custom"
                    ? kind === "proxy_failed"
                      ? "failed"
                      : "success"
                    : "skipped",
                message:
                  args.preferences.proxyMode === "custom"
                    ? "代理端点测试结果"
                    : "未单独测试代理端点",
                durationMs: 3,
                httpStatus: null,
              },
              youtube: {
                status:
                  kind === "proxy_failed"
                    ? "skipped"
                    : kind === "limited"
                      ? "limited"
                      : kind === "timeout"
                        ? "failed"
                        : "success",
                message:
                  kind === "limited"
                    ? "HTTP 403 访问受限"
                    : kind === "timeout"
                      ? "访问 YouTube 超时"
                      : kind === "proxy_failed"
                        ? "代理失败，未执行 YouTube 请求"
                        : "YouTube 连通性检查通过，不代表下载一定成功",
                durationMs: kind === "proxy_failed" ? null : 40,
                httpStatus: kind === "success" ? 204 : kind === "limited" ? 403 : null,
              },
            };
          }
          if (command === "save_network_preferences") {
            if (state.delay)
              await new Promise((resolve) => window.setTimeout(resolve, state.delay));
            if (state.failSave)
              throw { code: "invalid_url", message: "代理配置未保存，请重试。", retryable: true };
            state.preferences = {
              ...args.preferences,
              proxyUrl:
                args.preferences.proxyMode === "custom"
                  ? `${args.preferences.proxyUrl.replace(/\/$/, "")}/`
                  : "",
            };
            return state.preferences;
          }
          if (command === "get_cookie_preferences")
            return { cookiesFilePath: null, cookiesBrowser: null, accessConfirmed: false };
          if (command === "get_download_preferences")
            return { outputDirectory: "", maxConcurrent: 1, conflictStrategy: "skip" };
          if (command.startsWith("plugin:event|")) return 1;
          return [];
        },
      };
    },
    { failLoad, failSave, delay },
  );
  await page.goto(`${base}#/settings`);
  const panel = page.getByRole("region", { name: "网络与代理", exact: true });
  await panel.waitFor();
  return { page, panel, errors };
}

async function choose(page, panel, label) {
  await panel.getByRole("combobox", { name: "连接方式", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}
async function saved(panel) {
  await panel.getByRole("status").filter({ hasText: "网络设置已保存。" }).waitFor();
}
async function calls(page) {
  return page.evaluate(() =>
    window.proxyFixture.calls.filter((call) => call.command === "save_network_preferences"),
  );
}

try {
  {
    const { page, panel, errors } = await fixture();
    await choose(page, panel, "自定义代理");
    await panel
      .getByRole("textbox", { name: "代理地址", exact: true })
      .fill(" http://127.0.0.1:7890 ");
    await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
    await saved(panel);
    assert.deepEqual((await calls(page))[0].args.preferences, {
      proxyMode: "custom",
      proxyUrl: "http://127.0.0.1:7890",
    });
    assert.equal(
      await panel.getByRole("textbox", { name: "代理地址", exact: true }).inputValue(),
      "http://127.0.0.1:7890/",
    );
    await panel.screenshot({ path: "/tmp/savebeam-network-proxy-settings.png" });
    await page.getByRole("link", { name: "下载", exact: true }).click();
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await page.getByRole("textbox", { name: "代理地址", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("textbox", { name: "代理地址", exact: true }).inputValue(),
      "http://127.0.0.1:7890/",
    );
    await choose(page, panel, "直连（不使用代理）");
    assert.equal(await panel.getByRole("textbox", { name: "代理地址", exact: true }).count(), 0);
    await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
    await saved(panel);
    assert.deepEqual((await calls(page)).at(-1).args.preferences, {
      proxyMode: "direct",
      proxyUrl: "",
    });
    await panel.getByRole("button", { name: "恢复默认网络", exact: true }).click();
    await saved(panel);
    assert.deepEqual((await calls(page)).at(-1).args.preferences, {
      proxyMode: "default",
      proxyUrl: "",
    });
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write("custom save/readback, direct, reset: passed\n");
  }
  {
    const { page, panel, errors } = await fixture();
    await choose(page, panel, "自定义代理");
    for (const value of [
      "",
      "ftp://localhost",
      "http://user:secret@host",
      "http://host/path",
      "--exec=bad",
    ]) {
      await panel.getByRole("textbox", { name: "代理地址", exact: true }).fill(value);
      await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
      await panel.getByRole("alert").waitFor();
      assert.ok(!(await panel.getByRole("alert").textContent()).includes("secret"));
    }
    assert.equal((await calls(page)).length, 0);
    await panel
      .getByRole("textbox", { name: "代理地址", exact: true })
      .fill("socks5h://[::1]:1080");
    await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
    await saved(panel);
    assert.equal((await calls(page))[0].args.preferences.proxyUrl, "socks5h://[::1]:1080");
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write("invalid endpoints blocked without IPC, SOCKS5h IPv6: passed\n");
  }
  {
    const { page, panel, errors } = await fixture({ failLoad: true });
    await panel.getByRole("alert").waitFor();
    assert.equal(
      await panel.getByRole("button", { name: "保存网络设置", exact: true }).isDisabled(),
      true,
    );
    assert.equal((await calls(page)).length, 0);
    await page.evaluate(() => {
      window.proxyFixture.failLoad = false;
    });
    await panel.getByRole("button", { name: "重新读取网络设置", exact: true }).click();
    await choose(page, panel, "自定义代理");
    await panel
      .getByRole("textbox", { name: "代理地址", exact: true })
      .fill("http://127.0.0.1:7890");
    await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
    await saved(panel);
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write("load failure, disabled save, retry recovery: passed\n");
  }
  {
    const { page, panel, errors } = await fixture({ failLoad: true });
    await panel.getByRole("alert").waitFor();
    await panel.getByRole("button", { name: "恢复默认网络", exact: true }).click();
    await saved(panel);
    assert.equal(
      await panel.getByRole("button", { name: "保存网络设置", exact: true }).isEnabled(),
      true,
    );
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write("explicit default recovery after unreadable settings: passed\n");
  }
  {
    const { page, panel, errors } = await fixture({ failSave: true, delay: 250 });
    await choose(page, panel, "自定义代理");
    const input = panel.getByRole("textbox", { name: "代理地址", exact: true });
    await input.fill("http://127.0.0.1:7890");
    await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
    assert.equal(await input.isDisabled(), true);
    assert.equal(
      await panel.getByRole("button", { name: "恢复默认网络", exact: true }).isDisabled(),
      true,
    );
    await panel.getByRole("alert").waitFor();
    assert.equal(await input.inputValue(), "http://127.0.0.1:7890");
    assert.equal(await panel.getByRole("status").count(), 0);
    await page.evaluate(() => {
      window.proxyFixture.failSave = false;
    });
    await panel.getByRole("button", { name: "保存网络设置", exact: true }).click();
    await saved(panel);
    assert.equal((await calls(page)).length, 2);
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write("save failure retains input, async lock, retry: passed\n");
  }
  {
    const { page, panel, errors } = await fixture();
    await choose(page, panel, "自定义代理");
    const input = panel.getByRole("textbox", { name: "代理地址", exact: true });
    await input.fill(" http://127.0.0.1:7890 ");
    assert.equal(
      await page.evaluate(
        () =>
          window.proxyFixture.calls.filter((call) => call.command === "test_network_connection")
            .length,
      ),
      0,
    );
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    assert.equal(await input.isDisabled(), true);
    assert.equal(
      await panel.getByRole("button", { name: "保存网络设置", exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await panel.getByRole("button", { name: "恢复默认网络", exact: true }).isDisabled(),
      true,
    );
    const result = panel.getByRole("region", { name: "连接测试结果", exact: true });
    await result.waitFor();
    assert.equal(await result.getByText("通过", { exact: true }).count(), 2);
    assert.equal((await calls(page)).length, 0, "Testing must not save preferences");
    assert.deepEqual(await page.evaluate(() => window.proxyFixture.preferences), {
      proxyMode: "default",
      proxyUrl: "",
    });
    assert.equal(
      await page.evaluate(
        () =>
          window.proxyFixture.calls.find((call) => call.command === "test_network_connection").args
            .preferences.proxyUrl,
      ),
      "http://127.0.0.1:7890",
    );
    await panel.screenshot({ path: "/tmp/savebeam-network-connection-test.png" });
    await input.fill("http://127.0.0.1:7891");
    assert.equal(await result.count(), 0, "Editing must clear stale test results");
    await page.evaluate(() => {
      window.proxyFixture.testKind = "proxy_failed";
    });
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    await result.getByText("失败", { exact: true }).waitFor();
    await result.getByText("未执行", { exact: true }).waitFor();
    await page.evaluate(() => {
      window.proxyFixture.testKind = "limited";
    });
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    await result.getByText("受限", { exact: true }).waitFor();
    await choose(page, panel, "直连（不使用代理）");
    assert.equal(await result.count(), 0);
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    await result.getByText("未执行", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      "connection test uses unsaved snapshot, locks controls, reports stages and clears stale results: passed\n",
    );
  }
  {
    const { page, panel, errors } = await fixture();
    await choose(page, panel, "自定义代理");
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    await panel.getByRole("alert").waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.proxyFixture.calls.filter((call) => call.command === "test_network_connection")
            .length,
      ),
      0,
    );
    await panel
      .getByRole("textbox", { name: "代理地址", exact: true })
      .fill("socks5h://localhost:1080");
    await page.evaluate(() => {
      window.proxyFixture.failTest = true;
    });
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    await panel.getByText("连接测试暂不可用，请重试。", { exact: true }).waitFor();
    assert.equal(await panel.getByRole("region", { name: "连接测试结果", exact: true }).count(), 0);
    assert.equal(
      await panel.getByRole("textbox", { name: "代理地址", exact: true }).isEnabled(),
      true,
    );
    await page.evaluate(() => {
      window.proxyFixture.failTest = false;
      window.proxyFixture.testKind = "timeout";
    });
    await panel.getByRole("button", { name: "测试连接", exact: true }).click();
    await panel.getByText("访问 YouTube 超时", { exact: true }).waitFor();
    assert.equal((await calls(page)).length, 0);
    assert.deepEqual(errors, []);
    await page.close();
    process.stdout.write(
      "connection test validation, command failure and timeout reporting: passed\n",
    );
  }
} finally {
  await browser.close();
}
