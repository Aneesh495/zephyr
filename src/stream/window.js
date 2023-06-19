/**
 * src/stream/window.js
 *
 * Temporal window state manager supporting Tumbling, Sliding, and Session windows.
 * Coordinates window slice assignments, session merging, and watermark-driven triggers.
 */

export class TimeWindow {
  /**
   * @param {bigint} start Window start timestamp (inclusive)
   * @param {bigint} end Window end timestamp (exclusive)
   */
  constructor(start, end) {
    this.start = BigInt(start);
    this.end = BigInt(end);
  }

  covers(timestamp) {
    const ts = BigInt(timestamp);
    return ts >= this.start && ts < this.end;
  }

  id() {
    return `${this.start}-${this.end}`;
  }
}

export class WindowAssigner {
  /**
   * Assigns an event timestamp to one or more time windows.
   *
   * @param {bigint|number} timestamp
   * @returns {Array<TimeWindow>}
   */
  assignWindows(timestamp) {
    throw new Error("assignWindows must be implemented by subclass");
  }
}

export class TumblingWindowAssigner extends WindowAssigner {
  /**
   * @param {number} sizeMs Window duration in milliseconds
   * @param {number} [offsetMs=0] Window alignment offset
   */
  constructor(sizeMs, offsetMs = 0) {
    super();
    this.sizeMs = BigInt(sizeMs);
    this.offsetMs = BigInt(offsetMs);
  }

  assignWindows(timestamp) {
    const ts = BigInt(timestamp);
    const start = ts - ((ts - this.offsetMs) % this.sizeMs);
    const end = start + this.sizeMs;
    return [new TimeWindow(start, end)];
  }
}

export class SlidingWindowAssigner extends WindowAssigner {
  /**
   * @param {number} sizeMs Total window length
   * @param {number} advanceMs Step interval between consecutive windows
   */
  constructor(sizeMs, advanceMs) {
    super();
    this.sizeMs = BigInt(sizeMs);
    this.advanceMs = BigInt(advanceMs);
  }

  assignWindows(timestamp) {
    const ts = BigInt(timestamp);
    const windows = [];
    const lastStart = ts - (ts % this.advanceMs);

    for (let start = lastStart; start > ts - this.sizeMs; start -= this.advanceMs) {
      if (start >= 0n) {
        windows.push(new TimeWindow(start, start + this.sizeMs));
      }
    }

    return windows;
  }
}

export class WindowStateManager {
  /**
   * @param {WindowAssigner} assigner
   */
  constructor(assigner) {
    this.assigner = assigner;
    /** @type {Map<string, { window: TimeWindow, key: string, events: Array<object>, state: object }>} */
    this.activeWindows = new Map();
  }

  /**
   * Adds an event to all applicable windows.
   *
   * @param {string} key Grouping key
   * @param {object} event Stream event
   * @returns {Array<TimeWindow>} Assigned windows
   */
  addEvent(key, event) {
    const windows = this.assigner.assignWindows(event.timestamp);

    for (const win of windows) {
      const winKey = `${key}@${win.id()}`;
      let entry = this.activeWindows.get(winKey);
      if (!entry) {
        entry = {
          window: win,
          key,
          events: [],
          state: {},
        };
        this.activeWindows.set(winKey, entry);
      }
      entry.events.push(event);
    }

    return windows;
  }

  /**
   * Triggers and returns all completed windows when watermark advances.
   *
   * @param {bigint|number} watermarkTs Current watermark timestamp
   * @returns {Array<{ window: TimeWindow, key: string, events: Array<object> }>} Triggered windows
   */
  advanceWatermark(watermarkTs) {
    const wm = BigInt(watermarkTs);
    const triggered = [];

    for (const [winKey, entry] of this.activeWindows) {
      if (wm >= entry.window.end) {
        triggered.push({
          window: entry.window,
          key: entry.key,
          events: entry.events,
        });
        this.activeWindows.delete(winKey);
      }
    }

    return triggered;
  }
}
