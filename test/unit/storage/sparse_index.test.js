/**
 * test/unit/storage/sparse_index.test.js
 *
 * Verifies SparseIndex entry serialization, binary search accuracy,
 * sparse interval throttling, and crash recovery truncation.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SparseIndex } from "../../../src/storage/sparse_index.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_index");

describe("Sparse Radix Index", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("appends entries and performs binary search lookups", () => {
    const idx = new SparseIndex({
      directory: TEST_DIR,
      baseOffset: 1000n,
      intervalBytes: 100,
    });
    idx.open();

    // Force first entry
    idx.maybeAppend(1000n, 0, true);
    // Position 50 is less than intervalBytes (100), should skip
    const skipped = idx.maybeAppend(1005n, 50);
    assert.strictEqual(skipped, false);

    // Position 120 is >= intervalBytes (100), should record
    const appended1 = idx.maybeAppend(1010n, 120);
    assert.strictEqual(appended1, true);

    const appended2 = idx.maybeAppend(1020n, 250);
    assert.strictEqual(appended2, true);

    assert.strictEqual(idx.entriesCount, 3);

    // Lookups
    assert.strictEqual(idx.lookup(999n), 0);
    assert.strictEqual(idx.lookup(1000n), 0);
    assert.strictEqual(idx.lookup(1005n), 0); // closest <= 1005 is 1000 at pos 0
    assert.strictEqual(idx.lookup(1010n), 120);
    assert.strictEqual(idx.lookup(1015n), 120);
    assert.strictEqual(idx.lookup(1020n), 250);
    assert.strictEqual(idx.lookup(9999n), 250);

    idx.close();
  });

  it("persists index entries and reloads cleanly from disk", () => {
    const idx = new SparseIndex({
      directory: TEST_DIR,
      baseOffset: 500n,
      intervalBytes: 50,
    });
    idx.open();

    idx.maybeAppend(500n, 0, true);
    idx.maybeAppend(510n, 60, true);
    idx.maybeAppend(520n, 130, true);
    idx.close();

    // Reopen
    const reopened = new SparseIndex({
      directory: TEST_DIR,
      baseOffset: 500n,
      intervalBytes: 50,
    });
    reopened.open();

    assert.strictEqual(reopened.entriesCount, 3);
    assert.strictEqual(reopened.lookup(515n), 60);
    assert.strictEqual(reopened.lookup(520n), 130);

    reopened.close();
  });

  it("truncates entries beyond valid physical position upon recovery", () => {
    const idx = new SparseIndex({
      directory: TEST_DIR,
      baseOffset: 0n,
      intervalBytes: 10,
    });
    idx.open();

    idx.maybeAppend(0n, 0, true);
    idx.maybeAppend(10n, 100, true);
    idx.maybeAppend(20n, 200, true);
    idx.maybeAppend(30n, 300, true);

    assert.strictEqual(idx.entriesCount, 4);

    // Truncate to position 150
    idx.truncateToPosition(150);

    assert.strictEqual(idx.entriesCount, 2);
    assert.strictEqual(idx.lookup(25n), 100);

    idx.close();
  });
});
