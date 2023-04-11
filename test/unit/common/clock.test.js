/**
 * test/unit/common/clock.test.js
 *
 * Verifies MonotonicClock precision and HybridLogicalClock causal invariants,
 * message ordering across nodes, and serialization.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MonotonicClock, HybridLogicalClock } from "../../../src/common/clock.js";

describe("Monotonic & Hybrid Logical Clock Engine", () => {
  it("MonotonicClock provides strictly increasing nanoseconds", () => {
    const t1 = MonotonicClock.nowNanos();
    let t2 = MonotonicClock.nowNanos();
    while (t2 === t1) {
      t2 = MonotonicClock.nowNanos();
    }
    assert.ok(t2 > t1);
  });

  it("HLC produces strictly monotonically increasing timestamps on local ticks", () => {
    const clock = new HybridLogicalClock("node-1");
    const ts1 = clock.now();
    const ts2 = clock.now();
    const ts3 = clock.now();

    assert.strictEqual(HybridLogicalClock.compare(ts1, ts2), -1);
    assert.strictEqual(HybridLogicalClock.compare(ts2, ts3), -1);
  });

  it("HLC satisfies causal ordering when receiving messages across nodes", () => {
    const clockA = new HybridLogicalClock("node-A");
    const clockB = new HybridLogicalClock("node-B");

    // Event on A
    const msgA = clockA.now();

    // Node B receives message from A and updates
    const receiptB = clockB.update(msgA);

    // B's clock must strictly exceed A's message
    assert.strictEqual(HybridLogicalClock.compare(msgA, receiptB), -1);
    assert.ok(receiptB.time >= msgA.time);
  });

  it("HLC rejects remote timestamps that exceed drift threshold", () => {
    const clock = new HybridLogicalClock("node-1", 5000);
    const futureTimestamp = {
      time: Date.now() + 100000,
      counter: 0,
      nodeId: "rogue-node",
    };

    assert.throws(
      () => clock.update(futureTimestamp),
      /Remote timestamp drift .* exceeds maximum allowed threshold/,
      "Must reject excessive clock drift"
    );
  });

  it("correctly packs and unpacks HLC timestamp buffers", () => {
    const ts = {
      time: 1712000000123,
      counter: 42,
      nodeId: "cluster-worker-07",
    };

    const packed = HybridLogicalClock.pack(ts);
    const unpacked = HybridLogicalClock.unpack(packed);

    assert.deepStrictEqual(unpacked, ts);
  });
});
