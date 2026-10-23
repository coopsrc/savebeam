import assert from "node:assert/strict";
import test from "node:test";
import {
  entryDuration,
  missingTitle,
  patchEntryMetadata,
  mergeSubscriptionMetadata,
} from "../src/features/subscriptions/entryMetadata.ts";
const entry = {
  id: "a",
  index: 72,
  title: "未命名视频",
  durationSeconds: null,
  downloaded: false,
  isNew: true,
  available: true,
  taskStatus: null,
};
const row = { id: "a", index: 72, title: "真正的视频名称", durationSeconds: 123, error: null };
test("legacy and empty titles are pending, not a fabricated actual title; durations remain optional", () => {
  for (const title of ["", " ", "未命名视频", "标题待补全"])
    assert.equal(missingTitle(title), true);
  assert.equal(missingTitle("真实标题"), false);
  assert.equal(entryDuration(123), "2:03");
  assert.equal(entryDuration(3661), "1:01:01");
  for (const value of [null, undefined, -1, 0, Infinity, NaN])
    assert.equal(entryDuration(value), null);
});
test("metadata patches require one matching original ID and index without changing selection flags", () => {
  const patched = patchEntryMetadata([entry], [row])[0];
  assert.equal(patched.title, row.title);
  assert.equal(patched.durationSeconds, 123);
  assert.equal(patched.isNew, true);
  assert.equal(patched.downloaded, false);
  assert.equal(entry.title, "未命名视频");
  for (const rows of [
    [{ ...row, id: "changed" }],
    [{ ...row, index: 73 }],
    [{ ...row, error: "failed" }],
    [row, row],
  ])
    assert.deepEqual(patchEntryMetadata([entry], rows), [entry]);
});
test("late placeholder snapshots preserve enriched metadata but cannot resurrect removed subscriptions or cross sources", () => {
  const series = {
    id: 1,
    url: "https://example.invalid/list",
    sourceId: "list",
    entries: [{ ...entry, title: row.title, durationSeconds: 123 }],
  };
  const incoming = { ...series, entries: [entry] };
  assert.equal(mergeSubscriptionMetadata([series], [incoming])[0].entries[0].title, row.title);
  assert.equal(mergeSubscriptionMetadata([series], [incoming])[0].entries[0].durationSeconds, 123);
  assert.deepEqual(mergeSubscriptionMetadata([series], []), []);
  assert.equal(
    mergeSubscriptionMetadata([series], [{ ...incoming, sourceId: "other" }])[0].entries[0].title,
    entry.title,
  );
});
