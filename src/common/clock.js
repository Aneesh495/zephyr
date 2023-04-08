/**
 * src/common/clock.js
 *
 * Hybrid Logical Clock (HLC) and monotonic time utilities for Zephyr.
 * Implements the Kulkarni et al. (2014) algorithm to provide monotonically
 * increasing, causal timestamps across distributed stream nodes.
 *
 * Guarantees:
 * 1. e1 -> e2 implies HLC(e1) < HLC(e2)
 * 2. Logical time l is bounded close to physical time pt (|l - pt| <= maxDrift)
 */

export class MonotonicClock {
  /**
   * Returns monotonic nanoseconds since process boot.
   *
   * @returns {bigint}
   */
  static nowNanos() {
    return process.hrtime.bigint();
  }

  /**
   * Returns monotonic milliseconds.
   *
   * @returns {number}
   */
  static nowMillis() {
    return Number(process.hrtime.bigint() / 1_000_000n);
  }
}

export class HybridLogicalClock {
  /**
   * @param {string|number} nodeId Unique node identifier
   * @param {number} [maxDriftMillis=60000] Maximum permissible drift from physical clock (60s default)
   */
  constructor(nodeId, maxDriftMillis = 60000) {
    this.nodeId = String(nodeId);
    this.maxDriftMillis = maxDriftMillis;

    // Highest physical time observed (milliseconds)
    this.l = Date.now();
    // Logical counter for identical physical timestamps
    this.c = 0;
  }

  _physicalTime() {
    return Date.now();
  }

  /**
   * Generates a new timestamp for a locally originated event.
   *
   * @returns {{ time: number, counter: number, nodeId: string }}
   */
  now() {
    const pt = this._physicalTime();
    const prevL = this.l;

    if (pt > prevL) {
      this.l = pt;
      this.c = 0;
    } else {
      this.l = prevL;
      this.c = this.c + 1;
    }

    return {
      time: this.l,
      counter: this.c,
      nodeId: this.nodeId,
    };
  }

  /**
   * Advances local clock upon receiving a remote event timestamp.
   * Enforces causal ordering: local clock will strictly exceed both
   * local and remote prior timestamps.
   *
   * @param {{ time: number, counter: number, nodeId: string }} remoteTimestamp
   * @returns {{ time: number, counter: number, nodeId: string }}
   */
  update(remoteTimestamp) {
    const pt = this._physicalTime();
    const prevL = this.l;
    const remoteL = remoteTimestamp.time;

    if (remoteL - pt > this.maxDriftMillis) {
      throw new Error(
        `Remote timestamp drift ${remoteL - pt}ms exceeds maximum allowed threshold ${this.maxDriftMillis}ms`
      );
    }

    this.l = Math.max(prevL, remoteL, pt);

    if (this.l === prevL && this.l === remoteL) {
      this.c = Math.max(this.c, remoteTimestamp.counter) + 1;
    } else if (this.l === prevL) {
      this.c = this.c + 1;
    } else if (this.l === remoteL) {
      this.c = remoteTimestamp.counter + 1;
    } else {
      this.c = 0;
    }

    return {
      time: this.l,
      counter: this.c,
      nodeId: this.nodeId,
    };
  }

  /**
   * Compares two HLC timestamps for strict partial or total ordering.
   *
   * @param {{ time: number, counter: number, nodeId: string }} a
   * @param {{ time: number, counter: number, nodeId: string }} b
   * @returns {number} -1 if a < b, 1 if a > b, 0 if identical
   */
  static compare(a, b) {
    if (a.time !== b.time) {
      return a.time < b.time ? -1 : 1;
    }
    if (a.counter !== b.counter) {
      return a.counter < b.counter ? -1 : 1;
    }
    if (a.nodeId !== b.nodeId) {
      return a.nodeId < b.nodeId ? -1 : 1;
    }
    return 0;
  }

  /**
   * Packs an HLC timestamp into a binary Buffer (8 bytes time, 4 bytes counter, UTF-8 nodeId).
   *
   * @param {{ time: number, counter: number, nodeId: string }} ts
   * @returns {Buffer}
   */
  static pack(ts) {
    const nodeBuf = Buffer.from(ts.nodeId, "utf8");
    const buf = Buffer.alloc(12 + nodeBuf.length);
    buf.writeBigInt64LE(BigInt(ts.time), 0);
    buf.writeUInt32LE(ts.counter >>> 0, 8);
    nodeBuf.copy(buf, 12);
    return buf;
  }

  /**
   * Unpacks a packed HLC buffer.
   *
   * @param {Buffer} buf
   * @returns {{ time: number, counter: number, nodeId: string }}
   */
  static unpack(buf) {
    const time = Number(buf.readBigInt64LE(0));
    const counter = buf.readUInt32LE(8);
    const nodeId = buf.subarray(12).toString("utf8");
    return { time, counter, nodeId };
  }
}
