/**
 * test/unit/stream/tdigest.test.js
 *
 * Verifies TDigest online quantile estimation against exact uniform distributions
 * and tests incremental window accumulators.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TDigest } from "../../../src/stream/tdigest.js";
import {
  CountAccumulator,
  SumAccumulator,
  AvgAccumulator,
  MinAccumulator,
  MaxAccumulator,
  VarianceAccumulator,
} from "../../../src/stream/aggregator.js";

describe("T-Digest Streaming Quantiles & Incremental Accumulators", () => {
  it("accumulates running count, sum, average, min, max, and Welford variance", () => {
    const count = new CountAccumulator();
    const sum = new SumAccumulator();
    const avg = new AvgAccumulator();
    const min = new MinAccumulator();
    const max = new MaxAccumulator();
    const variance = new VarianceAccumulator();

    const values = [10, 20, 30, 40, 50];
    for (const v of values) {
      count.add(v);
      sum.add(v);
      avg.add(v);
      min.add(v);
      max.add(v);
      variance.add(v);
    }

    assert.strictEqual(count.value(), 5);
    assert.strictEqual(sum.value(), 150);
    assert.strictEqual(avg.value(), 30);
    assert.strictEqual(min.value(), 10);
    assert.strictEqual(max.value(), 50);

    const vStats = variance.value();
    assert.strictEqual(vStats.mean, 30);
    assert.strictEqual(vStats.variance, 250); // sample variance of [10,20,30,40,50] is 250
    assert.ok(Math.abs(vStats.stdDev - Math.sqrt(250)) < 1e-9);
  });

  it("accurately estimates P50, P90, and P99 quantiles via TDigest", () => {
    const td = new TDigest(100);

    // Feed uniform integers from 1 to 10,000
    for (let i = 1; i <= 10000; i++) {
      td.add(i);
    }

    const p50 = td.quantile(0.50);
    const p90 = td.quantile(0.90);
    const p99 = td.quantile(0.99);

    // Uniform distribution bounds
    assert.ok(Math.abs(p50 - 5000) <= 150, `P50 expected ~5000, got ${p50}`);
    assert.ok(Math.abs(p90 - 9000) <= 150, `P90 expected ~9000, got ${p90}`);
    assert.ok(Math.abs(p99 - 9900) <= 100, `P99 expected ~9900, got ${p99}`);
  });
});
