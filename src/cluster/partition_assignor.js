/**
 * src/cluster/partition_assignor.js
 *
 * Partition assignment strategies for consumer groups and worker thread partitions.
 * Includes Range, RoundRobin, and Sticky Cooperative assignors for minimal-churn rebalancing.
 */

export class RangeAssignor {
  /**
   * Partitions assigned as contiguous ranges per topic.
   *
   * @param {Array<string>} consumers Sorted consumer IDs
   * @param {Map<string, number>} topicPartitions Map of topic -> partition count
   * @returns {Map<string, Array<{ topic: string, partition: number }>>}
   */
  assign(consumers, topicPartitions) {
    const assignment = new Map();
    for (const c of consumers) assignment.set(c, []);

    if (consumers.length === 0) return assignment;

    for (const [topic, numPartitions] of topicPartitions) {
      const numConsumers = consumers.length;
      const minPerConsumer = Math.floor(numPartitions / numConsumers);
      const remainder = numPartitions % numConsumers;

      let partCursor = 0;
      for (let i = 0; i < numConsumers; i++) {
        const cId = consumers[i];
        const count = minPerConsumer + (i < remainder ? 1 : 0);

        for (let p = 0; p < count; p++) {
          assignment.get(cId).push({ topic, partition: partCursor++ });
        }
      }
    }

    return assignment;
  }
}

export class RoundRobinAssignor {
  /**
   * Partitions interleaved round-robin across consumers.
   *
   * @param {Array<string>} consumers
   * @param {Map<string, number>} topicPartitions
   * @returns {Map<string, Array<{ topic: string, partition: number }>>}
   */
  assign(consumers, topicPartitions) {
    const assignment = new Map();
    for (const c of consumers) assignment.set(c, []);

    if (consumers.length === 0) return assignment;

    const allPartitions = [];
    for (const [topic, numPartitions] of topicPartitions) {
      for (let p = 0; p < numPartitions; p++) {
        allPartitions.push({ topic, partition: p });
      }
    }

    let consumerIdx = 0;
    for (const tp of allPartitions) {
      const cId = consumers[consumerIdx];
      assignment.get(cId).push(tp);
      consumerIdx = (consumerIdx + 1) % consumers.length;
    }

    return assignment;
  }
}

export class StickyCooperativeAssignor {
  /**
   * Reassigns partitions preserving existing ownership where possible,
   * guaranteeing fair distribution where counts differ by at most 1.
   *
   * @param {Array<string>} consumers Current alive consumers
   * @param {Map<string, number>} topicPartitions
   * @param {Map<string, Array<{ topic: string, partition: number }>>} prevAssignment
   * @returns {Map<string, Array<{ topic: string, partition: number }>>}
   */
  assign(consumers, topicPartitions, prevAssignment = new Map()) {
    const assignment = new Map();
    for (const c of consumers) assignment.set(c, []);

    if (consumers.length === 0) return assignment;

    const allPartitions = [];
    for (const [topic, numPartitions] of topicPartitions) {
      for (let p = 0; p < numPartitions; p++) {
        allPartitions.push({ topic, partition: p });
      }
    }

    const total = allPartitions.length;
    const numC = consumers.length;
    const minPerC = Math.floor(total / numC);
    const remainder = total % numC;

    // Maximum number of consumers allowed to hold (minPerC + 1) partitions
    let extraCapacityAllowed = remainder;

    const unassigned = [];
    const activeConsumerSet = new Set(consumers);
    const assignedKeys = new Set();

    // 1. Retain existing assignments respecting individual quotas
    for (const [cId, parts] of prevAssignment) {
      if (activeConsumerSet.has(cId)) {
        for (const p of parts) {
          const key = `${p.topic}:${p.partition}`;
          const currentCount = assignment.get(cId).length;

          let allowed = false;
          if (currentCount < minPerC) {
            allowed = true;
          } else if (currentCount === minPerC && extraCapacityAllowed > 0) {
            allowed = true;
            extraCapacityAllowed--;
          }

          if (allowed && !assignedKeys.has(key)) {
            assignedKeys.add(key);
            assignment.get(cId).push(p);
          } else {
            unassigned.push(p);
          }
        }
      }
    }

    // 2. Add unassigned partitions not present in previous assignments
    for (const tp of allPartitions) {
      const key = `${tp.topic}:${tp.partition}`;
      if (!assignedKeys.has(key) && !unassigned.some((u) => u.topic === tp.topic && u.partition === tp.partition)) {
        unassigned.push(tp);
      }
    }

    // 3. Assign unassigned partitions to consumers with fewest assignments
    for (const tp of unassigned) {
      let minConsumer = consumers[0];
      let minCount = assignment.get(minConsumer).length;

      for (let i = 1; i < consumers.length; i++) {
        const c = consumers[i];
        const count = assignment.get(c).length;
        if (count < minCount) {
          minCount = count;
          minConsumer = c;
        }
      }

      assignment.get(minConsumer).push(tp);
    }

    return assignment;
  }
}
