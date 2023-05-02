/**
 * test/unit/storage/compactor.test.js
 *
 * Verifies LogCompactor key deduplication, historical state purging,
 * tombstone expiration, and segment replacement.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PartitionLog } from "../../../src/storage/partition_log.js";
import { LogCompactor } from "../../../src/storage/compactor.js";
import { RecordType, FrameFlags } from "../../../src/common/binary_frame.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_compactor");

describe("Background Log Compactor & Tombstone Cleaner", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("deduplicates historical keys in sealed segments while retaining latest values", () => {
    const log = new PartitionLog({
      directory: TEST_DIR,
      topic: "user_profiles",
      partition: 0,
      maxSegmentBytes: 250, // Small segment to force sealing
    });
    log.open();

    // Write multiple versions of user_1 and user_2
    log.append({ type: RecordType.DATA, key: "user_1", value: "version_1" });
    log.append({ type: RecordType.DATA, key: "user_2", value: "initial" });
    log.append({ type: RecordType.DATA, key: "user_1", value: "version_2" });
    log.append({ type: RecordType.DATA, key: "user_3", value: "steady" });
    log.append({ type: RecordType.DATA, key: "user_1", value: "version_final" });

    // Active segment has not rolled or needs an active segment ahead
    // Append enough to force another segment
    for (let i = 0; i < 5; i++) {
      log.append({ type: RecordType.DATA, key: `filler_${i}`, value: `data_${i}` });
    }

    assert.ok(log.segments.length >= 2, "Must have sealed segments for compaction");

    const compactor = new LogCompactor({ tombstoneRetentionMs: 1000 });
    const stats = compactor.compact(log);

    assert.ok(stats.recordsPruned > 0, "Compaction must prune older key versions");
    assert.ok(stats.bytesReclaimed > 0, "Compaction must reclaim storage bytes");

    // Read log and verify user_1 only contains version_final
    const records = log.read(0n, 50);
    const user1Records = records.filter((r) => r.key.toString("utf8") === "user_1");
    assert.strictEqual(user1Records.length, 1);
    assert.strictEqual(user1Records[0].value.toString("utf8"), "version_final");

    log.close();
  });
});
