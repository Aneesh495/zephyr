/**
 * test/regressions/barrier_starvation.test.js
 *
 * Regression test for Bug ZEP-001:
 * Synchronous while-loop in SequenceBarrier caused Node.js event-loop starvation
 * when publisher and waiter executed within the same thread context.
 *
 * Solution: Introduced waitForAsync using cooperative setImmediate scheduling,
 * preserving synchronous waitForSync specifically for isolated worker threads.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SequenceBarrier } from "../../src/concurrency/mpmc_barrier.js";

describe("Regression ZEP-001: SequenceBarrier Event-Loop Starvation", () => {
  it("allows event-loop timers and promises to execute while waiting on sequence", async () => {
    const shared = new BigInt64Array(new SharedArrayBuffer(64));
    const barrier = new SequenceBarrier(shared, 0);

    let backgroundExecuted = false;

    // Schedule a background task that must not be starved
    setTimeout(() => {
      backgroundExecuted = true;
      barrier.publish(1n);
    }, 15);

    const result = await barrier.waitForAsync(1n, 500);

    assert.strictEqual(result, 1n);
    assert.strictEqual(backgroundExecuted, true, "Background timer must have had event-loop time to execute");
  });
});
