/**
 * src/cluster/coordinator.js
 *
 * Cluster group coordinator orchestrating consumer group membership,
 * generation counters, heartbeat timeouts, and cooperative partition rebalance.
 */

import { StickyCooperativeAssignor } from "./partition_assignor.js";

export class ConsumerGroup {
  constructor(groupId, assignor = new StickyCooperativeAssignor()) {
    this.groupId = groupId;
    this.assignor = assignor;
    this.generationId = 0;
    this.leaderId = null;
    this.members = new Map(); // memberId -> { lastHeartbeat, subscribedTopics }
    this.assignment = new Map(); // memberId -> Array<{ topic, partition }>
  }

  addMember(memberId, subscribedTopics = []) {
    this.members.set(memberId, {
      lastHeartbeat: Date.now(),
      subscribedTopics,
    });

    if (!this.leaderId || !this.members.has(this.leaderId)) {
      this.leaderId = memberId;
    }
  }

  removeMember(memberId) {
    this.members.delete(memberId);
    this.assignment.delete(memberId);
    if (this.leaderId === memberId) {
      this.leaderId = this.members.keys().next().value || null;
    }
  }

  heartbeat(memberId) {
    const member = this.members.get(memberId);
    if (member) {
      member.lastHeartbeat = Date.now();
      return true;
    }
    return false;
  }

  rebalance(topicPartitions) {
    this.generationId++;
    const activeMembers = Array.from(this.members.keys()).sort();
    this.assignment = this.assignor.assign(activeMembers, topicPartitions, this.assignment);
    return {
      generationId: this.generationId,
      leaderId: this.leaderId,
      assignment: this.assignment,
    };
  }
}

export class ClusterCoordinator {
  constructor() {
    /** @type {Map<string, ConsumerGroup>} */
    this.groups = new Map();
  }

  getOrCreateGroup(groupId) {
    let group = this.groups.get(groupId);
    if (!group) {
      group = new ConsumerGroup(groupId);
      this.groups.set(groupId, group);
    }
    return group;
  }

  joinGroup(groupId, memberId, topics, topicPartitions) {
    const group = this.getOrCreateGroup(groupId);
    group.addMember(memberId, topics);
    return group.rebalance(topicPartitions);
  }

  leaveGroup(groupId, memberId, topicPartitions) {
    const group = this.groups.get(groupId);
    if (group) {
      group.removeMember(memberId);
      if (group.members.size === 0) {
        this.groups.delete(groupId);
        return null;
      }
      return group.rebalance(topicPartitions);
    }
    return null;
  }
}
