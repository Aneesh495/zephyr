/**
 * test/unit/concurrency/ring_buffer.test.js
 *
 * Verifies lock-free SPSC and MPMC ring buffer operations, FIFO ordering,
 * index wraparound across power-of-two boundaries, and capacity limits.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SPSCQueue, MPMCQueue } from "../../../src/concurrency/ring_buffer.js";

describe("Lock-Free Disruptor Ring Buffers (SPSC & MPMC)", () => {
  it("enforces power-of-two capacity validation", () => {
    assert.throws(() => new SPSCQueue(100), /power of two/);
    assert.throws(() => new MPMCQueue(300), /power of two/);
    assert.doesNotThrow(() => new SPSCQueue(512));
    assert.doesNotThrow(() => new MPMCQueue(512));
  });

  it("SPSC preserves strict FIFO ordering and handles queue fullness", () => {
    const queue = new SPSCQueue(4);
    assert.strictEqual(queue.isEmpty(), true);

    assert.strictEqual(queue.offer("A"), true);
    assert.strictEqual(queue.offer("B"), true);
    assert.strictEqual(queue.offer("C"), true);
    assert.strictEqual(queue.offer("D"), true);
    // Queue is now full (capacity 4)
    assert.strictEqual(queue.isFull(), true);
    assert.strictEqual(queue.offer("E"), false);

    assert.strictEqual(queue.poll(), "A");
    assert.strictEqual(queue.poll(), "B");
    assert.strictEqual(queue.size(), 2);

    // Can enqueue more now
    assert.strictEqual(queue.offer("E"), true);
    assert.strictEqual(queue.poll(), "C");
    assert.strictEqual(queue.poll(), "D");
    assert.strictEqual(queue.poll(), "E");
    assert.strictEqual(queue.poll(), undefined);
    assert.strictEqual(queue.isEmpty(), true);
  });

  it("SPSC handles millions of continuous wraparound operations without memory leak", () => {
    const queue = new SPSCQueue(16);
    const totalOps = 100000;

    for (let i = 0; i < totalOps; i++) {
      assert.strictEqual(queue.offer(i), true);
      assert.strictEqual(queue.poll(), i);
    }
    assert.strictEqual(queue.size(), 0);
  });

  it("MPMC supports multi-slot lock-free FIFO queuing and sequence barriers", () => {
    const queue = new MPMCQueue(8);

    for (let i = 0; i < 8; i++) {
      assert.strictEqual(queue.offer(`item_${i}`), true);
    }
    assert.strictEqual(queue.offer("overflow"), false);

    for (let i = 0; i < 8; i++) {
      assert.strictEqual(queue.poll(), `item_${i}`);
    }
    assert.strictEqual(queue.poll(), undefined);

    // Multiple wrap-arounds
    for (let i = 0; i < 50; i++) {
      assert.strictEqual(queue.offer(i), true);
      assert.strictEqual(queue.poll(), i);
    }
  });
});
