/**
 * test/unit/stream/window.test.js
 *
 * Verifies Tumbling and Sliding window assigners, slice calculation,
 * and watermark-driven window evaluation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TumblingWindowAssigner,
  SlidingWindowAssigner,
  WindowStateManager,
} from "../../../src/stream/window.js";

describe("Streaming Window State Manager", () => {
  it("assigns events to tumbling windows and triggers upon watermark completion", () => {
    // 5-second tumbling window
    const assigner = new TumblingWindowAssigner(5000);
    const manager = new WindowStateManager(assigner);

    // Add event at t = 1000
    manager.addEvent("sensor-1", { timestamp: 1000n, val: 10 });
    // Add event at t = 3000
    manager.addEvent("sensor-1", { timestamp: 3000n, val: 20 });
    // Add event at t = 6000 (belongs to next window 5000-10000)
    manager.addEvent("sensor-1", { timestamp: 6000n, val: 30 });

    // Watermark advances to 4000: neither window is complete
    const t1 = manager.advanceWatermark(4000n);
    assert.strictEqual(t1.length, 0);

    // Watermark advances to 5000: first window [0..5000) triggers
    const t2 = manager.advanceWatermark(5000n);
    assert.strictEqual(t2.length, 1);
    assert.strictEqual(t2[0].window.start, 0n);
    assert.strictEqual(t2[0].window.end, 5000n);
    assert.strictEqual(t2[0].events.length, 2);

    // Watermark advances to 10000: second window [5000..10000) triggers
    const t3 = manager.advanceWatermark(10000n);
    assert.strictEqual(t3.length, 1);
    assert.strictEqual(t3[0].window.start, 5000n);
    assert.strictEqual(t3[0].events.length, 1);
  });

  it("assigns events to multiple overlapping sliding windows", () => {
    // 10-second window advancing every 5 seconds
    const assigner = new SlidingWindowAssigner(10000, 5000);

    // Event at t = 6000 belongs to [0..10000) and [5000..15000)
    const wins = assigner.assignWindows(6000n);
    assert.strictEqual(wins.length, 2);

    const spans = wins.map((w) => `${w.start}-${w.end}`);
    assert.ok(spans.includes("0-10000"));
    assert.ok(spans.includes("5000-15000"));
  });
});
