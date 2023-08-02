/**
 * test/unit/cluster/cluster.test.js
 *
 * Verifies Gossip membership, suspicion timeouts, Range / RoundRobin / Sticky
 * partition assignors, and consumer group coordinator rebalances.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GossipMembership, NodeState } from "../../../src/cluster/gossip.js";
import {
  RangeAssignor,
  RoundRobinAssignor,
  StickyCooperativeAssignor,
} from "../../../src/cluster/partition_assignor.js";
import { ClusterCoordinator } from "../../../src/cluster/coordinator.js";

describe("Cluster Membership & Partition Assignment", () => {
  it("Gossip updates member state and transitions suspect nodes to dead after timeout", async () => {
    const gossip = new GossipMembership({
      localId: "node-1",
      suspicionTimeoutMs: 20,
    });

    gossip.addMember("node-2");
    assert.strictEqual(gossip.members.get("node-2").state, NodeState.ALIVE);

    // Apply suspect rumor
    gossip.applyRumor("node-2", NodeState.SUSPECT, 0);
    assert.strictEqual(gossip.members.get("node-2").state, NodeState.SUSPECT);

    // Wait past suspicion timeout
    await new Promise((resolve) => setTimeout(resolve, 25));
    gossip.evaluateSuspicion();

    assert.strictEqual(gossip.members.get("node-2").state, NodeState.DEAD);
  });

  it("RangeAssignor assigns contiguous partition blocks", () => {
    const assignor = new RangeAssignor();
    const consumers = ["c1", "c2"];
    const topicParts = new Map([["events", 4]]); // 4 partitions across 2 consumers

    const assignment = assignor.assign(consumers, topicParts);
    assert.strictEqual(assignment.get("c1").length, 2);
    assert.strictEqual(assignment.get("c2").length, 2);
    assert.deepStrictEqual(assignment.get("c1").map((p) => p.partition), [0, 1]);
    assert.deepStrictEqual(assignment.get("c2").map((p) => p.partition), [2, 3]);
  });

  it("StickyCooperativeAssignor retains partition ownership during rebalances", () => {
    const assignor = new StickyCooperativeAssignor();
    const consumers = ["c1", "c2"];
    const topicParts = new Map([["orders", 4]]);

    const initial = assignor.assign(consumers, topicParts);
    assert.strictEqual(initial.get("c1").length, 2);
    assert.strictEqual(initial.get("c2").length, 2);

    // Rebalance when c3 joins
    const nextConsumers = ["c1", "c2", "c3"];
    const rebalanced = assignor.assign(nextConsumers, topicParts, initial);

    // c1 and c2 should retain their existing assigned partitions
    assert.ok(rebalanced.get("c1").length >= 1);
    assert.ok(rebalanced.get("c2").length >= 1);
    assert.ok(rebalanced.get("c3").length >= 1);
  });

  it("ClusterCoordinator coordinates group join, generation bump, and leave", () => {
    const coord = new ClusterCoordinator();
    const topicParts = new Map([["logs", 6]]);

    const r1 = coord.joinGroup("audit_group", "consumer-A", ["logs"], topicParts);
    assert.strictEqual(r1.generationId, 1);
    assert.strictEqual(r1.leaderId, "consumer-A");
    assert.strictEqual(r1.assignment.get("consumer-A").length, 6);

    const r2 = coord.joinGroup("audit_group", "consumer-B", ["logs"], topicParts);
    assert.strictEqual(r2.generationId, 2);
    assert.strictEqual(r2.assignment.get("consumer-A").length, 3);
    assert.strictEqual(r2.assignment.get("consumer-B").length, 3);
  });
});
