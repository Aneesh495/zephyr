/**
 * src/stream/aggregator.js
 *
 * Incremental stateful window accumulators computing Count, Sum, Average,
 * Min, Max, and one-pass Welford variance in O(1) space and time.
 */

export class CountAccumulator {
  constructor() {
    this.count = 0n;
  }
  add() {
    this.count += 1n;
  }
  value() {
    return Number(this.count);
  }
}

export class SumAccumulator {
  constructor() {
    this.sum = 0;
  }
  add(val) {
    this.sum += Number(val);
  }
  value() {
    return this.sum;
  }
}

export class AvgAccumulator {
  constructor() {
    this.count = 0;
    this.sum = 0;
  }
  add(val) {
    this.count += 1;
    this.sum += Number(val);
  }
  value() {
    return this.count > 0 ? this.sum / this.count : 0;
  }
}

export class MinAccumulator {
  constructor() {
    this.min = Infinity;
  }
  add(val) {
    const v = Number(val);
    if (v < this.min) this.min = v;
  }
  value() {
    return this.min === Infinity ? 0 : this.min;
  }
}

export class MaxAccumulator {
  constructor() {
    this.max = -Infinity;
  }
  add(val) {
    const v = Number(val);
    if (v > this.max) this.max = v;
  }
  value() {
    return this.max === -Infinity ? 0 : this.max;
  }
}

/**
 * Welford's algorithm for numerically stable online variance and standard deviation.
 */
export class VarianceAccumulator {
  constructor() {
    this.count = 0;
    this.mean = 0;
    this.M2 = 0;
  }

  add(val) {
    const x = Number(val);
    this.count += 1;
    const delta = x - this.mean;
    this.mean += delta / this.count;
    const delta2 = x - this.mean;
    this.M2 += delta * delta2;
  }

  variance() {
    return this.count > 1 ? this.M2 / (this.count - 1) : 0;
  }

  stdDev() {
    return Math.sqrt(this.variance());
  }

  value() {
    return {
      count: this.count,
      mean: this.mean,
      variance: this.variance(),
      stdDev: this.stdDev(),
    };
  }
}
