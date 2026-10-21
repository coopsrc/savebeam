import assert from "node:assert/strict";
import test from "node:test";
import { isPending } from "../src/features/subscriptions/selection.ts";

const entry = {
  id: "v72",
  index: 72,
  title: "更新",
  downloaded: false,
  available: true,
  isNew: true,
  taskStatus: null,
};
test("subscription selections admit unseen and failed items but not downloaded or in-flight IDs", () => {
  assert.equal(isPending(entry), true);
  for (const taskStatus of ["failed", "cancelled"])
    assert.equal(isPending({ ...entry, taskStatus }), true);
  for (const taskStatus of ["queued", "preparing", "downloading", "post_processing", "cancelling"])
    assert.equal(isPending({ ...entry, taskStatus }), false);
  assert.equal(isPending({ ...entry, downloaded: true }), false);
  assert.equal(isPending({ ...entry, available: false }), false);
});
