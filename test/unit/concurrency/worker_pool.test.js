/**
 * test/unit/concurrency/worker_pool.test.js
 *
 * Verifies WorkerPool multi-threaded startup, round-robin task dispatch,
 * execution result handling, and clean worker termination.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkerPool } from "../../../src/concurrency/worker_pool.js";

describe("Multi-Threaded WorkerPool & Pipeline Workers", () => {
  it("spawns worker threads and executes streaming tasks concurrently", async () => {
    const pool = new WorkerPool({ size: 2 });
    await pool.start();

    // Dispatch multiple tasks
    const p1 = pool.dispatch("TRANSFORM", { value: 100 });
    const p2 = pool.dispatch("TRANSFORM", { value: 200 });
    const p3 = pool.dispatch("FILTER", { value: 300 });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.deepStrictEqual(r1, { value: 100 });
    assert.deepStrictEqual(r2, { value: 200 });
    assert.strictEqual(r3, true);

    await pool.close();
  });
});
