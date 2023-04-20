/**
 * test/unit/storage/segment.test.js
 *
 * Verifies LogSegment append operations, offset advancement, physical position reads,
 * and crash recovery with truncation of torn or corrupt trailing writes.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LogSegment } from "../../../src/storage/segment.js";
import { RecordType } from "../../../src/common/binary_frame.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_segment");

describe("Append-Only LogSegment Storage", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a new segment file and appends records monotonically", () => {
    const seg = new LogSegment({
      directory: TEST_DIR,
      baseOffset: 100n,
      maxSizeBytes: 4096,
    });
    seg.open();

    const r1 = seg.append({ type: RecordType.DATA, key: "k1", value: "val1" });
    assert.strictEqual(r1.offset, 100n);
    assert.strictEqual(r1.position, 0);

    const r2 = seg.append({ type: RecordType.DATA, key: "k2", value: "val2" });
    assert.strictEqual(r2.offset, 101n);
    assert.ok(r2.position > 0);

    assert.strictEqual(seg.recordCount, 2);
    assert.strictEqual(seg.nextOffset, 102n);

    // Verify reading back at physical positions
    const read1 = seg.readAt(r1.position);
    assert.strictEqual(read1.offset, 100n);
    assert.strictEqual(read1.key.toString("utf8"), "k1");
    assert.strictEqual(read1.value.toString("utf8"), "val1");

    const read2 = seg.readAt(r2.position);
    assert.strictEqual(read2.offset, 101n);
    assert.strictEqual(read2.key.toString("utf8"), "k2");

    seg.close();
  });

  it("recovers valid records and truncates torn trailing writes on reopening", () => {
    const seg = new LogSegment({
      directory: TEST_DIR,
      baseOffset: 0n,
    });
    seg.open();

    seg.append({ type: RecordType.DATA, key: "good_1", value: "payload1" });
    seg.append({ type: RecordType.DATA, key: "good_2", value: "payload2" });
    const validSize = seg.size;
    seg.close();

    // Simulate an unclean shutdown by appending garbage bytes to the segment file
    fs.appendFileSync(seg.segmentPath, Buffer.from("CORRUPT_TRAILING_TORN_WRITE_DATA"));

    // Reopen segment: recovery must detect corruption and truncate back to valid size
    const recoveredSeg = new LogSegment({
      directory: TEST_DIR,
      baseOffset: 0n,
    });
    recoveredSeg.open();

    assert.strictEqual(recoveredSeg.size, validSize);
    assert.strictEqual(recoveredSeg.recordCount, 2);
    assert.strictEqual(recoveredSeg.nextOffset, 2n);

    // Assert that we can still append new records cleanly onto recovered segment
    const r3 = recoveredSeg.append({ type: RecordType.DATA, key: "good_3", value: "payload3" });
    assert.strictEqual(r3.offset, 2n);

    recoveredSeg.close();
  });
});
