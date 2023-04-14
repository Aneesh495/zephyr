/**
 * test/unit/common/metrics.test.js
 *
 * Verifies MetricRegistry counters, gauges, and Vitter's reservoir-sampled
 * histograms for quantile calculations.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MetricRegistry } from "../../../src/common/metrics.js";

describe("Telemetry & MetricRegistry Subsystem", () => {
  it("increments counters and tracks cumulative operations", () => {
    const reg = new MetricRegistry();
    const c = reg.counter("events_ingested_total");
    c.inc(10);
    c.inc(5);
    assert.strictEqual(c.get(), 15);
  });

  it("updates and reads instantaneous gauges", () => {
    const reg = new MetricRegistry();
    const g = reg.gauge("active_connections");
    g.set(42);
    assert.strictEqual(g.get(), 42);
    g.set(100);
    assert.strictEqual(g.get(), 100);
  });

  it("computes accurate percentiles via reservoir-sampled histogram", () => {
    const reg = new MetricRegistry();
    const h = reg.histogram("query_latency_ms", "Query execution latency", 1000);

    // Feed numbers 1 to 1000
    for (let i = 1; i <= 1000; i++) {
      h.observe(i);
    }

    const snap = h.snapshot();
    assert.strictEqual(snap.count, 1000);
    assert.strictEqual(snap.min, 1);
    assert.strictEqual(snap.max, 1000);
    assert.ok(Math.abs(snap.p50 - 500) <= 25, `P50 should be ~500, got ${snap.p50}`);
    assert.ok(Math.abs(snap.p90 - 900) <= 25, `P90 should be ~900, got ${snap.p90}`);
    assert.ok(Math.abs(snap.p99 - 990) <= 15, `P99 should be ~990, got ${snap.p99}`);
  });
});
