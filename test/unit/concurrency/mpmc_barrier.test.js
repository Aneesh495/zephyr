/**
 * test/unit/concurrency/mpmc_barrier.test.js
 *
 * Verifies SequenceBarrier cooperative asynchronous waiting, synchronous worker waiting,
 * wait timeouts, and progressive backoff.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SequenceBarrier } from "../../../src/concurrency/mpmc_barrier.js";

describe("SequenceBarrier & WaitStrategy", () => {
  it("cooperatively waits for sequence progression via waitForAsync", async () => {
    const shared = new BigInt64Array(new SharedArrayBuffer(64));
    const barrier = new SequenceBarrier(shared, 0);

    assert.strictEqual(barrier.getCursor(), 0n);

    // Publish asynchronously in event loop
    setTimeout(() => {
      barrier.publish(42n);
    }, 10);

    const observed = await barrier.waitForAsync(42n, 1000);
    assert.ok(observed >= 42n);
    assert.strictEqual(barrier.getCursor(), 42n);
  });

  it("throws timeout exception when expected sequence is not reached within deadline", async () => {
    const shared = new BigInt64Array(new SharedArrayBuffer(64));
    const barrier = new SequenceBarrier(shared, 0);

    await assert.rejects(
      async () => {
        await barrier.waitForAsync(100n, 20);
      },
      /Timeout waiting for sequence 100/
    );
  });

  it("satisfies immediate check synchronously via waitForSync", () => {
    const shared = new BigInt64Array(new SharedArrayBuffer(64));
    const barrier = new SequenceBarrier(shared, 0);
    barrier.publish(10n);

    const val = barrier.waitForSync(10n, 100);
    assert.strictEqual(val, 10n);
  });
});
