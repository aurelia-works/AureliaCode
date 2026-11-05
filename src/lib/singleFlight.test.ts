import assert from "node:assert/strict";
import test from "node:test";
import { singleFlight } from "./singleFlight.ts";

test("calls in flight share one run; once it settles the next call runs again", async () => {
  let calls = 0;
  let release!: () => void;
  const run = singleFlight(() => {
    calls++;
    return new Promise<void>((r) => (release = r));
  });
  const a = run();
  const b = run();
  assert.equal(calls, 1, "a second call while the first is running joins it");
  release();
  await Promise.all([a, b]);
  const c = run();
  assert.equal(calls, 2, "after it settled, a new call runs again (a failed first load must be retryable)");
  release();
  await c;
});

test("force starts a new run even while one is in flight", async () => {
  let calls = 0;
  const run = singleFlight(async () => {
    calls++;
  });
  const a = run();
  const b = run(true);
  await Promise.all([a, b]);
  assert.equal(calls, 2);
});
