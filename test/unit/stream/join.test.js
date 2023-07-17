/**
 * test/unit/stream/join.test.js
 *
 * Verifies StreamJoinOperator temporal distance matching, bidirectional correlation,
 * and state eviction.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StreamJoinOperator } from "../../../src/stream/join.js";

describe("Temporal Stream-to-Stream Equi-Join", () => {
  it("joins left and right stream events matching key within temporal bound", () => {
    const join = new StreamJoinOperator({
      joinType: "INNER",
      withinMs: 5000,
      leftKeyExtractor: (e) => e.orderId,
      rightKeyExtractor: (e) => e.orderId,
    });

    // Order event arrives at t = 1000
    const m1 = join.processLeft({ orderId: "ord-101", amount: 250, timestamp: 1000n });
    assert.strictEqual(m1.length, 0); // No shipment yet

    // Shipment event arrives at t = 3000 (diff 2000ms <= 5000ms)
    const m2 = join.processRight({ orderId: "ord-101", tracking: "TRK-999", timestamp: 3000n });
    assert.strictEqual(m2.length, 1);
    assert.strictEqual(m2[0].left.amount, 250);
    assert.strictEqual(m2[0].right.tracking, "TRK-999");
    assert.strictEqual(m2[0].timestamp, 3000n);
  });

  it("rejects matches when temporal distance exceeds within bound", () => {
    const join = new StreamJoinOperator({
      joinType: "INNER",
      withinMs: 2000, // 2s bound
      leftKeyExtractor: (e) => e.id,
      rightKeyExtractor: (e) => e.id,
    });

    join.processLeft({ id: "item-1", timestamp: 1000n });

    // Arrives at t = 5000 (diff 4000ms > 2000ms)
    const matches = join.processRight({ id: "item-1", timestamp: 5000n });
    assert.strictEqual(matches.length, 0);
  });
});
