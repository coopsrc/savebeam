import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import test from "node:test";

test("desktop window starts at least 1280x720 and cannot resize below that logical size", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  );
  const window = config.app.windows[0];
  assert.equal(window.minWidth, 1280);
  assert.equal(window.minHeight, 720);
  assert.ok(window.width >= window.minWidth && window.height >= window.minHeight);
  assert.equal(window.resizable, true);
});
