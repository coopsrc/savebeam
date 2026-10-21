import assert from "node:assert/strict";
import test from "node:test";
import {
  outputPreview,
  previewComponent,
  selectedEntries,
} from "../src/features/download/outputPreview.ts";

const media = { id: "BV19wee6BEeP", title: "视频：标题", playlist: null };
const playlist = {
  id: "list-123",
  title: "课程",
  downloadCount: 3,
  totalCount: 5,
  truncated: false,
  entries: [
    { index: 1, id: "v1", title: "第一课", available: true },
    { index: 2, id: null, title: "不可用", available: false },
    { index: 3, id: "v3", title: "第三课", available: true },
    { index: 5, id: "v5", title: "第五课", available: true },
  ],
};

test("single output previews video ID and selected extension including MP3", () => {
  assert.deepEqual(outputPreview(media, "mp4", []), {
    directory: null,
    files: ["视频：标题 [BV19wee6BEeP].mp4"],
  });
  assert.equal(outputPreview(media, "mp3", []).files[0], "视频：标题 [BV19wee6BEeP].mp3");
});

test("series previews only selected items in original order with directory and video IDs", () => {
  const preview = outputPreview({ ...media, playlist }, null, [5, 1]);
  assert.equal(preview.directory, "课程 [list-123]");
  assert.deepEqual(preview.files, ["1-第一课 [v1].{扩展名}", "5-第五课 [v5].{扩展名}"]);
  assert.deepEqual(outputPreview({ ...media, playlist }, "mp3", [3]).files, ["3-第三课 [v3].mp3"]);
});

test("empty, unavailable and stale selections cannot preview unintended items", () => {
  assert.deepEqual(selectedEntries(playlist, [2, 99]), []);
  assert.deepEqual(outputPreview({ ...media, playlist }, null, []).files, []);
  assert.equal(selectedEntries(playlist, [1, 1]).length, 1);
});

test("missing group IDs are omitted instead of using the input URL or a video ID", () => {
  const preview = outputPreview({ ...media, playlist: { ...playlist, id: null } }, null, [1]);
  assert.equal(preview.directory, "课程");
});

test("display cleaning preserves Unicode and does not treat user titles as templates or paths", () => {
  assert.equal(previewComponent("测试/标题\\01:02:03? %(id)s"), "测试⧸标题⧹01_02_03？ %(id)s");
  assert.equal(previewComponent(".."), "_");
  assert.equal(previewComponent("\n标题\t"), " 标题");
});

test("older backend metadata without entries is safe but cannot invent a selection", () => {
  assert.deepEqual(selectedEntries({ ...playlist, entries: undefined }, [1]), []);
});
