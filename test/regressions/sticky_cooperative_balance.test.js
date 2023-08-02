/**
 * test/regressions/sticky_cooperative_balance.test.js
 *
 * Regression test for Bug ZEP-004:
 * StickyCooperativeAssignor retained 100% of previous assignments when a new consumer
 * joined, leaving the newly joined consumer with 0 partitions.
 *
 * Solution: Enforced quota limits where at most remainder consumers retain minPerConsumer + 1,
 * revoking excess partitions so new consumers achieve balanced partition assignments.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StickyCooperativeAssignor } from "../../src/cluster/partition_assignor.js";

describe("Regression ZEP-004: Sticky Cooperative Partition Quota Balancing", () => {
  it("guarantees newly joined consumers receive partitions by revoking surplus from existing members", () => {
    const assignor = new StickyCooperativeAssignor();
    const topicParts = new Map([["stream", 4]]);

    // Step 1: Single consumer gets all 4
    const a1 = assignor.assign(["c1"], topicParts);
    assert.strictEqual(a1.get("c1").length, 4);

    // Step 2: Second consumer joins: must balance to 2 and 2
    const a2 = assignor.assign(["c1", "c2"], topicParts, a1);
    assert.strictEqual(a2.get("c1").length, 2);
    assert.strictEqual(a2.get("c2").length, 2);

    // Step 3: Third consumer joins: 4 / 3 = [2, 1, 1]
    const a3 = assignor.assign(["c1", "c2", "c3"], topicParts, a2);
    const counts = [a3.get("c1").length, a3.get("c2").length, a3.get("c3").length].sort();
    assert.deepStrictEqual(counts, [1, 1, 2]);
  });
});
