import test from "node:test";
import { setImmediate } from "node:timers";
import assert from "node:assert/strict";
import { rollingQueue } from "../src/utils/rollingQueue.ts";
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("a fast item immediately replenishes a slot while another item is still running", async () => {
  const started = [];
  const finish = {};
  const run = rollingQueue([1, 2, 3, 4], 2, async (item) => {
    started.push(item);
    await new Promise((resolve) => (finish[item] = resolve));
  });
  await tick();
  assert.deepEqual(started, [1, 2]);
  finish[2]();
  await tick();
  assert.deepEqual(started, [1, 2, 3]);
  finish[3]();
  await tick();
  assert.deepEqual(started, [1, 2, 3, 4]);
  finish[4]();
  finish[1]();
  await run;
});
test("discovered P children share slots and stop does not start waiting children", async () => {
  const started = [];
  const finish = {};
  let stopped = false;
  let maximum = 0;
  const run = rollingQueue(
    [1, 2],
    2,
    async (item, enqueue) => {
      started.push(item);
      if (item === 1) enqueue([3, 4]);
      await new Promise((resolve) => (finish[item] = resolve));
    },
    () => stopped,
    (n) => (maximum = Math.max(maximum, n)),
  );
  await tick();
  assert.deepEqual(started, [1, 2]);
  finish[1]();
  await tick();
  assert.deepEqual(started, [1, 2, 3]);
  stopped = true;
  finish[2]();
  finish[3]();
  await run;
  assert.equal(maximum, 2);
  assert.ok(!started.includes(4));
});
