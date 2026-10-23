import assert from "node:assert/strict";
import test from "node:test";
import {
  expandedEntries,
  selectedDownloadEntries,
  entryLabel,
  expandedOverrides,
} from "../src/features/download/playlistParts.ts";

const part = (index) => ({
  index: 13000 + index,
  id: `BV1uVy7BCErV_p${index}`,
  title: `P${index}`,
  formats: [],
  error: null,
  part: { parentIndex: 13, partIndex: index, partCount: 2 },
});
const media = {
  playlist: {
    entries: [
      { index: 12, id: "a", title: "前一集", available: true },
      { index: 13, id: "BV1uVy7BCErV", title: "标题待补全", available: true },
      { index: 14, id: "b", title: "下一集", available: true },
    ],
  },
};
const details = { 13: { title: "避震特别篇", parts: [part(1), part(2)] } };
test("multipart expansion preserves collection order and selection, with independent part keys", () => {
  const entries = expandedEntries(media, details);
  assert.deepEqual(
    entries.map((e) => e.index),
    [12, 13001, 13002, 14],
  );
  assert.deepEqual(
    selectedDownloadEntries(entries, [13]).map((e) => e.index),
    [13001, 13002],
  );
  assert.deepEqual(
    selectedDownloadEntries(entries, [13002]).map((e) => e.index),
    [13002],
  );
  assert.equal(entryLabel(entries[1]), "第 13 项 · P1");
  assert.equal(entries[1].parentTitle, "避震特别篇");
});
test("part overrides inherit parent exceptions then permit per-part override; partial queue cannot reselect parent", () => {
  const entries = expandedEntries(media, details);
  const parentPolicy = { resolutionHeight: 720 };
  const childPolicy = { resolutionHeight: 1080 };
  assert.deepEqual(expandedOverrides(entries, { 13: parentPolicy, 13002: childPolicy }), [
    { index: 13001, policy: parentPolicy },
    { index: 13002, policy: childPolicy },
  ]);
  const remaining = selectedDownloadEntries(entries, [13])
    .map((e) => e.index)
    .filter((i) => i !== 13001);
  assert.deepEqual(
    selectedDownloadEntries(entries, remaining).map((e) => e.index),
    [13002],
  );
  assert.equal(expandedEntries(null, {}).length, 0);
});
