import assert from "node:assert/strict";
import test from "node:test";
import { useAppStore } from "../src/stores/appStore.ts";

function reset() {
  useAppStore.setState({
    downloadTasks: [],
    removedTaskIds: {},
    downloadProgress: {},
    downloadResults: {},
    lastDownloadError: null,
  });
}
const task = {
  id: "a",
  title: "A",
  url: "https://example.invalid/a",
  formatId: "18",
  status: "completed",
  createdAtUnixMs: 10,
};

test("removing a task clears only its task/progress/result projection", () => {
  reset();
  useAppStore.getState().upsertDownloadTask(task);
  useAppStore.getState().upsertDownloadTask({ ...task, id: "b" });
  useAppStore.getState().updateDownloadProgress({ taskId: "a" });
  useAppStore.getState().setDownloadResult({ taskId: "a" });
  useAppStore.getState().removeDownloadTask("a");
  assert.deepEqual(
    useAppStore.getState().downloadTasks.map((task) => task.id),
    ["b"],
  );
  assert.equal(useAppStore.getState().downloadProgress.a, undefined);
  assert.equal(useAppStore.getState().downloadResults.a, undefined);
  useAppStore.getState().removeDownloadTask("a");
  assert.equal(useAppStore.getState().downloadTasks.length, 1);
});

test("late state snapshots, progress, and result events cannot resurrect removed tasks", () => {
  reset();
  useAppStore.getState().removeDownloadTask("a");
  useAppStore.getState().upsertDownloadTask(task);
  useAppStore.getState().updateDownloadProgress({ taskId: "a" });
  useAppStore.getState().setDownloadResult({ taskId: "a" });
  assert.deepEqual(useAppStore.getState().downloadTasks, []);
  assert.deepEqual(useAppStore.getState().downloadProgress, {});
  assert.deepEqual(useAppStore.getState().downloadResults, {});
});
