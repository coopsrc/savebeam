import assert from "node:assert/strict";
import test from "node:test";
import {
  expandedEntries,
  selectedDownloadEntries,
  entryLabel,
  expandedOverrides,
  entryGroups,
  toggleGroupSelection,
  shortPartTitle,
  mediaType,
  taskDetails,
} from "../src/features/download/playlistParts.ts";

const part = (index) => ({
  index: 13000 + index,
  id: `BV1uVy7BCErV_p${index}`,
  title: `P${index}`,
  formats: [],
  error: null,
  part: { parentIndex: 13, partIndex: index, partCount: 2 },
});

test("header previews remain UI-only without mutating the hydrated source", () => {
  const source = {
    ...part(1),
    preview: { uploader: "作者", thumbnailDataUrl: "data:image/png;base64,test" },
  };
  const request = taskDetails(source);
  assert.equal(request.preview, undefined);
  assert.ok(source.preview);
  assert.equal(JSON.stringify(request).includes("thumbnailDataUrl"), false);
  assert.equal(request.id, source.id);
});

test("collapsible parent groups preserve selection keys, mixed state and independent other entries", () => {
  const entries = expandedEntries(media, details);
  const groups = entryGroups(entries);
  assert.deepEqual(
    groups.map((g) => g.parentIndex),
    [null, 13, null],
  );
  const children = groups[1].entries;
  assert.deepEqual(toggleGroupSelection(children, [12, 13001, 14], true), [12, 14, 13001, 13002]);
  assert.deepEqual(toggleGroupSelection(children, [12, 13001, 14], false), [12, 14]);
  assert.deepEqual(
    selectedDownloadEntries(entries, [13002]).map((e) => e.index),
    [13002],
  );
  assert.equal(entryLabel({ index: 2 }, true), "P2");
});

test("display-only short titles remove only the exact parent prefix and matching P marker", () => {
  assert.equal(shortPartTitle("避震特别篇 p01 解说版", "避震特别篇", 1), "解说版");
  assert.equal(shortPartTitle("避震特别篇 p02 纯享版", "避震特别篇", 2), "纯享版");
  assert.equal(shortPartTitle("另一个完整标题", "避震特别篇", 2), "另一个完整标题");
  assert.equal(shortPartTitle("p03 不同P", undefined, 2), "p03 不同P");
  assert.equal(mediaType({ mediaType: "multipart", playlist: {} }), "multipart");
  assert.equal(mediaType({ playlist: {} }), "collection");
  assert.equal(mediaType(null), "single");
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
