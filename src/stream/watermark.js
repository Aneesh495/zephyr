/**
 * src/stream/watermark.js
 *
 * Watermark generation and out-of-order event time progression.
 * Implements bounded out-of-order lateness tracking and punctuated watermark extraction.
 *
 * Watermark invariant:
 * A watermark W(t) asserts that no further events with timestamp T <= W(t) will arrive.
 * Events arriving with T < W(t) are flagged as late events and routed to side-outputs.
 */

export class Watermark {
  /**
   * @param {bigint|number} timestamp
   */
  constructor(timestamp) {
    this.timestamp = BigInt(timestamp);
  }

  toString() {
    return `Watermark(${this.timestamp})`;
  }
}

export class BoundedOutOfOrderWatermarkGenerator {
  /**
   * @param {object} [options]
   * @param {number} [options.maxOutOfOrdernessMs=5000] Maximum allowed lateness (5s default)
   */
  constructor({ maxOutOfOrdernessMs = 5000 } = {}) {
    this.maxOutOfOrdernessMs = BigInt(maxOutOfOrdernessMs);
    this.maxObservedTimestamp = 0n;
    this.currentWatermark = 0n;
  }

  /**
   * Evaluates an arriving event and updates maximum observed timestamp.
   *
   * @param {object} record Arriving stream event
   * @returns {{ isLate: boolean, watermark: Watermark|null }}
   */
  onEvent(record) {
    const ts = BigInt(record.timestamp);
    const isLate = this.currentWatermark > 0n && ts < this.currentWatermark;

    if (ts > this.maxObservedTimestamp) {
      this.maxObservedTimestamp = ts;
    }

    return {
      isLate,
      watermark: null, // Emitted periodically or on checkpoint
    };
  }

  /**
   * Advances the watermark threshold based on observed event time.
   *
   * @returns {Watermark}
   */
  generateWatermark() {
    if (this.maxObservedTimestamp === 0n) {
      return new Watermark(0n);
    }

    const candidate = this.maxObservedTimestamp - this.maxOutOfOrdernessMs;
    if (candidate > this.currentWatermark) {
      this.currentWatermark = candidate;
    }

    return new Watermark(this.currentWatermark);
  }
}

export class PunctuatedWatermarkGenerator {
  /**
   * @param {function(object): (bigint|null)} extractWatermarkFn
   */
  constructor(extractWatermarkFn) {
    this.extractFn = extractWatermarkFn;
    this.currentWatermark = 0n;
  }

  onEvent(record) {
    const wmTs = this.extractFn(record);
    if (wmTs !== null) {
      const candidate = BigInt(wmTs);
      if (candidate > this.currentWatermark) {
        this.currentWatermark = candidate;
        return { isLate: false, watermark: new Watermark(this.currentWatermark) };
      }
    }

    const ts = BigInt(record.timestamp);
    const isLate = this.currentWatermark > 0n && ts < this.currentWatermark;
    return { isLate, watermark: null };
  }
}
