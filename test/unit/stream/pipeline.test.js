/**
 * test/unit/stream/pipeline.test.js
 *
 * Verifies StreamPipeline execution DAG, chaining filter, map,
 * and window aggregation stages down to a terminal sink.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { StreamPipeline } from "../../../src/stream/pipeline.js";
import { TumblingWindowAssigner } from "../../../src/stream/window.js";

describe("StreamPipeline Execution DAG", () => {
  it("chains filtering, transformation, and sink emission cleanly", () => {
    const sinkResults = [];

    const pipeline = StreamPipeline.fromSource("sensor_input")
      .filter((e) => e.temp > 20)
      .map((e) => ({ ...e, tempFahrenheit: (e.temp * 9) / 5 + 32 }))
      .toSink((e) => sinkResults.push(e));

    pipeline.ingest({ temp: 15, id: "s1" }); // Filtered out
    pipeline.ingest({ temp: 25, id: "s2" }); // Accepted: 25C -> 77F

    assert.strictEqual(sinkResults.length, 1);
    assert.strictEqual(sinkResults[0].id, "s2");
    assert.strictEqual(sinkResults[0].tempFahrenheit, 77);
  });

  it("evaluates window aggregations within a streaming pipeline", () => {
    const windowResults = [];

    const pipeline = StreamPipeline.fromSource("trades")
      .windowAggregate({
        assigner: new TumblingWindowAssigner(5000),
        keyExtractor: (e) => e.symbol,
        aggregateFn: (events) => {
          let sum = 0;
          for (const ev of events) sum += ev.price;
          return { count: events.length, total: sum };
        },
        watermarkLatenessMs: 0,
      })
      .toSink((res) => windowResults.push(res));

    pipeline.ingest({ symbol: "AAPL", price: 150, timestamp: 1000n });
    pipeline.ingest({ symbol: "AAPL", price: 155, timestamp: 2000n });
    // Advance watermark past 5000
    pipeline.ingest({ symbol: "AAPL", price: 160, timestamp: 6000n });

    assert.strictEqual(windowResults.length, 1);
    assert.strictEqual(windowResults[0].key, "AAPL");
    assert.strictEqual(windowResults[0].value.count, 2);
    assert.strictEqual(windowResults[0].value.total, 305);
  });
});
