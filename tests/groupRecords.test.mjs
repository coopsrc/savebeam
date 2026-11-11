import assert from "node:assert/strict";
import test from "node:test";
import {
  groupRecords,
  taskGroupSummary,
  taskRecordGroups,
} from "../src/features/records/groupRecords.ts";
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

test("completed groups leave Tasks and return with new work, while History remains intact", () => {
  const completed = [
    { ...row("a", context("series", "合集", 1)), batchId: "previous" },
    row("single", null),
  ];
  assert.equal(taskRecordGroups(completed).length, 0);
  const queued = { ...row("new", context("series", "合集", 2), 10, "queued"), batchId: "current" };
  const mixed = taskRecordGroups([...completed, queued]);
  assert.equal(mixed.length, 1);
  assert.deepEqual(
    mixed[0].items.map((t) => t.id),
    ["new"],
  );
  assert.equal(taskGroupSummary(mixed[0].items).percent, 0);
  assert.equal(group(completed).length, 2);
  assert.equal(taskRecordGroups([...completed, { ...queued, status: "completed" }]).length, 0);
  for (const status of ["failed", "cancelled"])
    assert.equal(taskRecordGroups([{ ...queued, status }]).length, 1);
});

test("only completed siblings of unfinished rounds count, including legacy rows and simultaneous rounds", () => {
  const make = (id, batchId, status, index = 1) => ({
    ...row(id, context("a", "同一合集", index), 1, status),
    batchId,
  });
  const old = Array.from({ length: 10 }, (_, i) =>
    make("old" + i, i < 5 ? null : "archived", "completed", i + 1),
  );
  const live = Array.from({ length: 18 }, (_, i) => make("live" + i, "current", "queued", i + 1));
  let groups = taskRecordGroups([...old, ...live]);
  assert.equal(groups[0].items.length, 18);
  assert.equal(taskGroupSummary(groups[0].items).counts.completed, 0);
  live[0] = { ...live[0], status: "completed" };
  groups = taskRecordGroups([...old, ...live]);
  assert.equal(groups[0].items.length, 18);
  assert.equal(taskGroupSummary(groups[0].items).percent, 100 / 18);
  const additional = make("subscription-update", "another", "queued", 19);
  assert.equal(taskRecordGroups([...old, ...live, additional])[0].items.length, 19);
  const done = live.map((t) => ({ ...t, status: "completed" }));
  assert.deepEqual(
    taskRecordGroups([...old, ...done, additional])[0].items.map((t) => t.id),
    ["subscription-update"],
  );
  assert.equal(
    groupRecords(
      [...old, ...done],
      (t) => t.id,
      (t) => t.createdAtUnixMs,
    )[0].items.length,
    28,
  );
  const otherDone = {
    ...make("other-done", "current", "completed"),
    group: context("other", "另一合集", 1),
  };
  const otherQueued = {
    ...make("other-queued", "other-round", "queued"),
    group: context("other", "另一合集", 2),
  };
  const separate = taskRecordGroups([...live, otherDone, otherQueued]);
  assert.deepEqual(
    separate.find((g) => g.context.key === "other").items.map((t) => t.id),
    ["other-queued"],
  );
});
