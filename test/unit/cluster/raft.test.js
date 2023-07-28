/**
 * test/unit/cluster/raft.test.js
 *
 * Verifies Raft consensus state machine: leader election, majority quorum,
 * log replication, and state machine entry application.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RaftNode, RaftRole } from "../../../src/cluster/raft_node.js";
import { MockRaftTransport } from "../../../src/cluster/rpc_transport.js";

describe("Raft Distributed Consensus State Machine", () => {
  it("elects a single leader across a 3-node cluster quorum", async () => {
    const transport = new MockRaftTransport();
    const nodeA = new RaftNode({ id: "node-A", peers: ["node-B", "node-C"], minElectionTimeoutMs: 50, maxElectionTimeoutMs: 80 });
    const nodeB = new RaftNode({ id: "node-B", peers: ["node-A", "node-C"], minElectionTimeoutMs: 150, maxElectionTimeoutMs: 200 });
    const nodeC = new RaftNode({ id: "node-C", peers: ["node-A", "node-B"], minElectionTimeoutMs: 150, maxElectionTimeoutMs: 200 });

    transport.registerNode(nodeA);
    transport.registerNode(nodeB);
    transport.registerNode(nodeC);

    nodeA.start();
    nodeB.start();
    nodeC.start();

    // Wait for election to converge
    await new Promise((resolve) => setTimeout(resolve, 120));

    // Fast node (nodeA) should have won election
    assert.strictEqual(nodeA.role, RaftRole.LEADER);
    assert.strictEqual(nodeB.role, RaftRole.FOLLOWER);
    assert.strictEqual(nodeC.role, RaftRole.FOLLOWER);

    nodeA.close();
    nodeB.close();
    nodeC.close();
  });

  it("replicates log entries from leader and commits to followers", async () => {
    const transport = new MockRaftTransport();
    const leader = new RaftNode({ id: "leader", peers: ["follower-1", "follower-2"] });
    const follower1 = new RaftNode({ id: "follower-1", peers: ["leader", "follower-2"] });
    const follower2 = new RaftNode({ id: "follower-2", peers: ["leader", "follower-1"] });

    transport.registerNode(leader);
    transport.registerNode(follower1);
    transport.registerNode(follower2);

    leader.role = RaftRole.LEADER;
    leader.currentTerm = 1;

    // Leader appends a command
    leader.log.append(1, { action: "CREATE_PARTITION", partition: 0 });

    // Leader sends append entries to followers
    await Promise.all([
      leader.transport.sendAppendEntries("follower-1", {
        term: 1,
        leaderId: "leader",
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: leader.log.getEntriesFrom(1),
        leaderCommit: 1,
      }),
      leader.transport.sendAppendEntries("follower-2", {
        term: 1,
        leaderId: "leader",
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: leader.log.getEntriesFrom(1),
        leaderCommit: 1,
      }),
    ]);

    assert.strictEqual(follower1.log.lastIndex, 1);
    assert.strictEqual(follower2.log.lastIndex, 1);
    assert.strictEqual(follower1.stateMachine.length, 1);
    assert.strictEqual(follower1.stateMachine[0].action, "CREATE_PARTITION");

    leader.close();
    follower1.close();
    follower2.close();
  });
});
