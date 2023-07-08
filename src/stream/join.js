/**
 * src/stream/join.js
 *
 * Temporal stream-to-stream equi-join operator with bounded time intervals.
 * Maintains sliding state buffers for left and right streams indexed by join key,
 * matching events that satisfy: |T_left - T_right| <= withinMs.
 */

export class StreamJoinOperator {
  /**
   * @param {object} options
   * @param {string} options.joinType "INNER" or "LEFT"
   * @param {number} options.withinMs Maximum allowable temporal distance in milliseconds
   * @param {function(object): string} options.leftKeyExtractor
   * @param {function(object): string} options.rightKeyExtractor
   */
  constructor({
    joinType = "INNER",
    withinMs = 60000,
    leftKeyExtractor = (e) => e.key,
    rightKeyExtractor = (e) => e.key,
  }) {
    this.joinType = joinType;
    this.withinMs = BigInt(withinMs);
    this.leftKeyExtractor = leftKeyExtractor;
    this.rightKeyExtractor = rightKeyExtractor;

    /** @type {Map<string, Array<object>>} */
    this.leftBuffer = new Map();
    /** @type {Map<string, Array<object>>} */
    this.rightBuffer = new Map();
  }

  /**
   * Ingests an event from the left stream and searches right buffer for matches.
   *
   * @param {object} leftEvent
   * @returns {Array<object>} Joined result records
   */
  processLeft(leftEvent) {
    const key = this.leftKeyExtractor(leftEvent);
    const leftTs = BigInt(leftEvent.timestamp);

    // Buffer left event
    let leftList = this.leftBuffer.get(key);
    if (!leftList) {
      leftList = [];
      this.leftBuffer.set(key, leftList);
    }
    leftList.push(leftEvent);

    const matches = [];
    const rightList = this.rightBuffer.get(key);

    if (rightList) {
      for (const rightEvent of rightList) {
        const rightTs = BigInt(rightEvent.timestamp);
        const diff = leftTs >= rightTs ? leftTs - rightTs : rightTs - leftTs;

        if (diff <= this.withinMs) {
          matches.push({
            left: leftEvent,
            right: rightEvent,
            timestamp: leftTs > rightTs ? leftTs : rightTs,
            key,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Ingests an event from the right stream and searches left buffer for matches.
   *
   * @param {object} rightEvent
   * @returns {Array<object>} Joined result records
   */
  processRight(rightEvent) {
    const key = this.rightKeyExtractor(rightEvent);
    const rightTs = BigInt(rightEvent.timestamp);

    // Buffer right event
    let rightList = this.rightBuffer.get(key);
    if (!rightList) {
      rightList = [];
      this.rightBuffer.set(key, rightList);
    }
    rightList.push(rightEvent);

    const matches = [];
    const leftList = this.leftBuffer.get(key);

    if (leftList) {
      for (const leftEvent of leftList) {
        const leftTs = BigInt(leftEvent.timestamp);
        const diff = leftTs >= rightTs ? leftTs - rightTs : rightTs - leftTs;

        if (diff <= this.withinMs) {
          matches.push({
            left: leftEvent,
            right: rightEvent,
            timestamp: leftTs > rightTs ? leftTs : rightTs,
            key,
          });
        }
      }
    }

    return matches;
  }

  /**
   * Evicts buffered events older than watermark - withinMs to prevent unbounded memory growth.
   *
   * @param {bigint|number} watermark
   */
  evictExpired(watermark) {
    const cutoff = BigInt(watermark) - this.withinMs;
    if (cutoff <= 0n) return;

    for (const [key, list] of this.leftBuffer) {
      const filtered = list.filter((e) => BigInt(e.timestamp) >= cutoff);
      if (filtered.length === 0) {
        this.leftBuffer.delete(key);
      } else {
        this.leftBuffer.set(key, filtered);
      }
    }

    for (const [key, list] of this.rightBuffer) {
      const filtered = list.filter((e) => BigInt(e.timestamp) >= cutoff);
      if (filtered.length === 0) {
        this.rightBuffer.delete(key);
      } else {
        this.rightBuffer.set(key, filtered);
      }
    }
  }
}
