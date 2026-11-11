import assert from "node:assert/strict";
import test from "node:test";
import { groupRecords, taskGroupSummary } from "../src/features/records/groupRecords.ts";
const context = (key, title, index, part = null) => ({
  key,
  title,
  kind: "collection",
  sourceUrl: "https://example.invalid/list",
  itemIndex: index,
  partIndex: part,
});
const row = (id, group, createdAtUnixMs = 1, status = "completed") => ({
  id,
  group,
  createdAtUnixMs,
  status,
});
const group = (rows) =>
  groupRecords(
    rows,
    (r) => r.id,
    (r) => r.createdAtUnixMs,
  );
test("later batches and versions merge by stable parent only, with original item/part order", () => {
  const rows = [
    row("p2", context("a", "旧名", 13, 2), 1),
    row("other", context("b", "同名", 1), 2),
    row("p1", context("a", "新名", 13, 1), 5),
    row("v2", context("a", "新名", 13, 1), 7),
    row("single", null, 3),
  ];
  const result = group(rows);
  assert.equal(result.length, 3);
  assert.equal(result[0].context.title, "新名");
  assert.deepEqual(
    result[0].items.map((r) => r.id),
    ["v2", "p1", "p2"],
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["p2", "other", "p1", "v2", "single"],
  );
  assert.equal(group([row("a", null), row("b", null)]).length, 2);
});
test("known parent titles beat legacy URL placeholders and summaries never hide partial failure", () => {
  const result = group([
    row("a", context("x", "真实合集", 1), 1),
    row("b", context("x", "https://example.invalid/list", 2), 5),
    row("c", context("x", "真实合集新名称", 3), 2),
  ]);
  assert.equal(result[0].context.title, "真实合集新名称");
  const value = taskGroupSummary([
    row("a", null, 1, "completed"),
    row("b", null, 1, "failed"),
    row("c", null, 1, "queued"),
    row("d", null, 1, "cancelled"),
  ]);
  assert.equal(value.active, 1);
  assert.equal(value.counts.failed, 1);
  assert.equal(value.percent, 25);
  assert.equal(value.status, "active");
  assert.equal(taskGroupSummary([row("a", null, 1, "failed")]).status, "failed");
});
