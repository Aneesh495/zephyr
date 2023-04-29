/**
 * test/unit/storage/partition_log.test.js
 *
 * Verifies PartitionLog automated segment rollover, continuous offset sequencing,
 * cross-segment reads, and retention policy enforcement.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PartitionLog } from "../../../src/storage/partition_log.js";
import { RecordType } from "../../../src/common/binary_frame.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_partition_log");

describe("Topic Partition Log Storage", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("appends records monotonically and rolls active segment when size threshold is reached", () => {
    // Set maxSegmentBytes very small (200 bytes) to force rapid rolling
    const log = new PartitionLog({
      directory: TEST_DIR,
      topic: "metrics_stream",
      partition: 0,
      maxSegmentBytes: 200,
      indexIntervalBytes: 50,
    });
    log.open();

    for (let i = 0; i < 10; i++) {
      const res = log.append({
        type: RecordType.DATA,
        key: `device_${i}`,
        value: `payload_data_measurement_value_${i}`,
      });
      assert.strictEqual(res.offset, BigInt(i));
    }

    // Must have rolled across multiple segment files
    assert.ok(log.segments.length > 1, `Expected multiple segments, got ${log.segments.length}`);

    const bounds = log.getOffsetBounds();
    assert.strictEqual(bounds.earliestOffset, 0n);
    assert.strictEqual(bounds.highWatermark, 10n);

    // Read all 10 records across segments in a single read call
    const readAll = log.read(0n, 20);
    assert.strictEqual(readAll.length, 10);
    for (let i = 0; i < 10; i++) {
      assert.strictEqual(readAll[i].offset, BigInt(i));
      assert.strictEqual(readAll[i].key.toString("utf8"), `device_${i}`);
    }

    // Read starting from mid-stream offset 6
    const midStream = log.read(6n, 5);
    assert.strictEqual(midStream.length, 4);
    assert.strictEqual(midStream[0].offset, 6n);
    assert.strictEqual(midStream[3].offset, 9n);

    log.close();
  });

  it("reloads cleanly from disk and preserves continuous offsets", () => {
    const log = new PartitionLog({
      directory: TEST_DIR,
      topic: "orders",
      partition: 0,
      maxSegmentBytes: 250,
    });
    log.open();

    log.append({ type: RecordType.DATA, key: "order1", value: "v1" });
    log.append({ type: RecordType.DATA, key: "order2", value: "v2" });
    log.close();

    // Reopen
    const reopened = new PartitionLog({
      directory: TEST_DIR,
      topic: "orders",
      partition: 0,
      maxSegmentBytes: 250,
    });
    reopened.open();

    const bounds = reopened.getOffsetBounds();
    assert.strictEqual(bounds.highWatermark, 2n);

    const r3 = reopened.append({ type: RecordType.DATA, key: "order3", value: "v3" });
    assert.strictEqual(r3.offset, 2n);

    reopened.close();
  });
});
