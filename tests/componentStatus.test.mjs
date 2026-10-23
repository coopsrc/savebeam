import assert from "node:assert/strict";
import test from "node:test";
import {
  localComponentSummary,
  normalizeComponentKinds,
} from "../src/features/settings/componentStatus.ts";

const inventory = () =>
  ["yt_dlp", "ffmpeg", "ffprobe", "java_script_runtime"].map((kind) => ({
    kind,
    status: "available",
    source: "system",
    version: "1",
    executablePath: "/fixture/tool",
  }));
test("runtime legacy wire spelling is normalized without mutating inventory or release objects", () => {
  const raw = inventory();
  const result = normalizeComponentKinds(raw);
  assert.equal(result[3].kind, "javascript_runtime");
  assert.equal(raw[3].kind, "java_script_runtime");
  assert.equal(
    normalizeComponentKinds([{ kind: "javascript_runtime", version: "2" }])[0].version,
    "2",
  );
  assert.throws(() => normalizeComponentKinds([{ kind: "unexpected" }]));
});
test("local readiness requires exactly one available record of every required component", () => {
  const rows = normalizeComponentKinds(inventory());
  assert.equal(localComponentSummary(rows).ready, true);
  for (const status of ["missing", "outdated", "unhealthy"]) {
    assert.equal(
      localComponentSummary(rows.map((row, index) => (index === 3 ? { ...row, status } : row)))
        .ready,
      false,
    );
  }
  assert.equal(localComponentSummary(rows.slice(0, 3)).ready, false);
  assert.equal(localComponentSummary([...rows, rows[0]]).ready, false);
  assert.match(localComponentSummary([]).message, /0\/4/);
});
