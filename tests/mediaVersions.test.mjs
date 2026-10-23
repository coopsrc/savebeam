import assert from "node:assert/strict";
import test from "node:test";
import { compareVersionFiles, sourceLabels } from "../src/features/history/mediaVersions.ts";

const parent = { taskId: "root", files: [{ sha256: "a".repeat(64) }] };
const version = { taskId: "child", parentTaskId: "root", files: [{ sha256: "a".repeat(64) }] };
test("same final bytes are distinct from suspected remote source changes", () => {
  assert.equal(compareVersionFiles(version, [parent, version]), "与上一版本文件相同");
  assert.match(
    compareVersionFiles({ ...version, files: [{ sha256: "b".repeat(64) }] }, [parent]),
    /不同（不等于确认换源）/,
  );
  assert.match(sourceLabels.possible_change, /疑似/);
  assert.match(sourceLabels.no_obvious_change, /元数据/);
});
test("missing parents, legacy/missing hashes and multi-output records remain unknown", () => {
  assert.equal(compareVersionFiles({ ...parent, parentTaskId: null }, []), "原始下载");
  for (const item of [
    version,
    { ...version, files: [] },
    { ...version, files: [{ sha256: null }] },
    { ...version, files: [{ sha256: "bad" }] },
  ])
    assert.equal(compareVersionFiles(item, []), "缺少可比文件摘要");
  assert.equal(
    compareVersionFiles({ ...version, files: [{ sha256: "bad" }] }, [parent]),
    "缺少可比文件摘要",
  );
  assert.equal(
    compareVersionFiles({ ...version, files: [version.files[0], version.files[0]] }, [parent]),
    "缺少可比文件摘要",
  );
});
