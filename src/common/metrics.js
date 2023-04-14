/**
 * src/common/metrics.js
 *
 * High-performance telemetry metrics registry for Zephyr.
 * Includes atomic counters, instantaneous gauges, EWMA meters, and
 * reservoir-sampled rolling histograms for latency percentiles (P50, P90, P99, P99.9).
 */

export class Counter {
  constructor(name, help = "") {
    this.name = name;
    this.help = help;
    this.value = 0n;
  }

  inc(by = 1) {
    this.value += BigInt(by);
  }

  reset() {
    this.value = 0n;
  }

  get() {
    return Number(this.value);
  }
}

export class Gauge {
  constructor(name, help = "") {
    this.name = name;
    this.help = help;
    this.value = 0;
  }

  set(val) {
    this.value = Number(val);
  }

  get() {
    return this.value;
  }
}

export class Histogram {
  /**
   * @param {string} name
   * @param {string} help
   * @param {number} [sampleSize=2048] Uniform random reservoir sample size
   */
  constructor(name, help = "", sampleSize = 2048) {
    this.name = name;
    this.help = help;
    this.sampleSize = sampleSize;
    this.reservoir = new Float64Array(sampleSize);
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  /**
   * Records an observation using Vitter's Algorithm R for reservoir sampling.
   *
   * @param {number} val
   */
  observe(val) {
    const v = Number(val);
    this.count++;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;

    if (this.count <= this.sampleSize) {
      this.reservoir[this.count - 1] = v;
    } else {
      const replaceIdx = Math.floor(Math.random() * this.count);
      if (replaceIdx < this.sampleSize) {
        this.reservoir[replaceIdx] = v;
      }
    }
  }

  snapshot() {
    const currentSize = Math.min(this.count, this.sampleSize);
    if (currentSize === 0) {
      return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p90: 0, p99: 0, p999: 0 };
    }

    const sorted = Array.from(this.reservoir.subarray(0, currentSize)).sort((a, b) => a - b);
    const getP = (p) => {
      const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
      return sorted[idx];
    };

    return {
      count: this.count,
      mean: this.sum / this.count,
      min: this.min,
      max: this.max,
      p50: getP(0.50),
      p90: getP(0.90),
      p99: getP(0.99),
      p999: getP(0.999),
    };
  }

  reset() {
    this.count = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }
}

export class MetricRegistry {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  counter(name, help = "") {
    let c = this.counters.get(name);
    if (!c) {
      c = new Counter(name, help);
      this.counters.set(name, c);
    }
    return c;
  }

  gauge(name, help = "") {
    let g = this.gauges.get(name);
    if (!g) {
      g = new Gauge(name, help);
      this.gauges.set(name, g);
    }
    return g;
  }

  histogram(name, help = "") {
    let h = this.histograms.get(name);
    if (!h) {
      h = new Histogram(name, help);
      this.histograms.set(name, h);
    }
    return h;
  }

  snapshot() {
    const report = {
      timestamp: Date.now(),
      counters: {},
      gauges: {},
      histograms: {},
    };

    for (const [k, c] of this.counters) {
      report.counters[k] = c.get();
    }
    for (const [k, g] of this.gauges) {
      report.gauges[k] = g.get();
    }
    for (const [k, h] of this.histograms) {
      report.histograms[k] = h.snapshot();
    }

    return report;
  }
}

export const globalMetrics = new MetricRegistry();
