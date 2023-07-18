/**
 * src/stream/pipeline.js
 *
 * Pipelined execution DAG connecting streaming sources, filters, maps,
 * stateful windows, aggregators, joins, and sink destinations.
 */

import { EventEmitter } from "node:events";
import { WindowStateManager, TumblingWindowAssigner, SlidingWindowAssigner } from "./window.js";
import { BoundedOutOfOrderWatermarkGenerator } from "./watermark.js";

export class StreamStage extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.next = null;
  }

  pipe(nextStage) {
    this.next = nextStage;
    return nextStage;
  }

  process(event) {
    if (this.next) {
      this.next.process(event);
    }
  }
}

export class FilterStage extends StreamStage {
  constructor(predicateFn) {
    super("FILTER");
    this.predicateFn = predicateFn;
  }

  process(event) {
    if (this.predicateFn(event)) {
      super.process(event);
    }
  }
}

export class MapStage extends StreamStage {
  constructor(transformFn) {
    super("MAP");
    this.transformFn = transformFn;
  }

  process(event) {
    const transformed = this.transformFn(event);
    if (transformed != null) {
      super.process(transformed);
    }
  }
}

export class WindowAggregateStage extends StreamStage {
  /**
   * @param {object} options
   * @param {import('./window.js').WindowAssigner} options.assigner
   * @param {function(object): string} options.keyExtractor
   * @param {function(Array<object>): object} options.aggregateFn
   * @param {number} [options.watermarkLatenessMs=1000]
   */
  constructor({ assigner, keyExtractor, aggregateFn, watermarkLatenessMs = 1000 }) {
    super("WINDOW_AGGREGATE");
    this.keyExtractor = keyExtractor;
    this.aggregateFn = aggregateFn;
    this.windowManager = new WindowStateManager(assigner);
    this.watermarkGen = new BoundedOutOfOrderWatermarkGenerator({ maxOutOfOrdernessMs: watermarkLatenessMs });
  }

  process(event) {
    const key = this.keyExtractor(event);
    this.windowManager.addEvent(key, event);

    const { isLate } = this.watermarkGen.onEvent(event);
    if (isLate) {
      this.emit("late_event", event);
      return;
    }

    const wm = this.watermarkGen.generateWatermark();
    const completedWindows = this.windowManager.advanceWatermark(wm.timestamp);

    for (const win of completedWindows) {
      const aggregatedResult = this.aggregateFn(win.events);
      const emission = {
        key: win.key,
        windowStart: win.window.start,
        windowEnd: win.window.end,
        value: aggregatedResult,
        timestamp: win.window.end,
      };
      super.process(emission);
    }
  }
}

export class StreamPipeline {
  constructor() {
    this.head = null;
    this.tail = null;
  }

  static fromSource(name = "SOURCE") {
    const pipeline = new StreamPipeline();
    const sourceStage = new StreamStage(name);
    pipeline.head = sourceStage;
    pipeline.tail = sourceStage;
    return pipeline;
  }

  filter(predicateFn) {
    const stage = new FilterStage(predicateFn);
    this.tail.pipe(stage);
    this.tail = stage;
    return this;
  }

  map(transformFn) {
    const stage = new MapStage(transformFn);
    this.tail.pipe(stage);
    this.tail = stage;
    return this;
  }

  windowAggregate({ assigner, keyExtractor, aggregateFn, watermarkLatenessMs }) {
    const stage = new WindowAggregateStage({ assigner, keyExtractor, aggregateFn, watermarkLatenessMs });
    this.tail.pipe(stage);
    this.tail = stage;
    return this;
  }

  toSink(sinkFn) {
    const sinkStage = new StreamStage("SINK");
    sinkStage.process = (event) => {
      sinkFn(event);
    };
    this.tail.pipe(sinkStage);
    this.tail = sinkStage;
    return this;
  }

  ingest(event) {
    if (this.head) {
      this.head.process(event);
    }
  }
}
