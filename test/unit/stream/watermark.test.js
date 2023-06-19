/**
 * test/unit/stream/watermark.test.js
 *
 * Verifies BoundedOutOfOrderWatermarkGenerator lateness boundaries,
 * monotonic progression, and punctuated watermark extraction.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BoundedOutOfOrderWatermarkGenerator,
  PunctuatedWatermarkGenerator,
} from "../../../src/stream/watermark.js";

describe("Watermark Generation & Event Time Engine", () => {
  it("advances watermark monotonically based on max observed event time minus lateness", () => {
    const gen = new BoundedOutOfOrderWatermarkGenerator({ maxOutOfOrdernessMs: 1000 });

    // Event at t = 5000
    gen.onEvent({ timestamp: 5000n });
    const wm1 = gen.generateWatermark();
    assert.strictEqual(wm1.timestamp, 4000n);

    // Out-of-order event at t = 4500 (still >= 4000 watermark, so on-time)
    const e2 = gen.onEvent({ timestamp: 4500n });
    assert.strictEqual(e2.isLate, false);

    // Event at t = 10000
    gen.onEvent({ timestamp: 10000n });
    const wm2 = gen.generateWatermark();
    assert.strictEqual(wm2.timestamp, 9000n);

    // Late event arriving at t = 8500 (less than current watermark 9000)
    const eLate = gen.onEvent({ timestamp: 8500n });
    assert.strictEqual(eLate.isLate, true);
  });

  it("extracts punctuated watermarks directly from marked stream events", () => {
    const gen = new PunctuatedWatermarkGenerator((event) => {
      return event.isCheckpoint ? event.timestamp : null;
    });

    const res1 = gen.onEvent({ timestamp: 1000n, isCheckpoint: false });
    assert.strictEqual(res1.watermark, null);

    const res2 = gen.onEvent({ timestamp: 2000n, isCheckpoint: true });
    assert.ok(res2.watermark !== null);
    assert.strictEqual(res2.watermark.timestamp, 2000n);

    // Event arriving prior to checkpoint timestamp must be flagged late
    const res3 = gen.onEvent({ timestamp: 1500n, isCheckpoint: false });
    assert.strictEqual(res3.isLate, true);
  });
});
