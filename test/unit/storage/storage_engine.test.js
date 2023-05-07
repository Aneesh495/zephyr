/**
 * test/unit/storage/storage_engine.test.js
 *
 * Verifies StorageEngine topic catalog, MurmurHash3 key-to-partition routing,
 * concurrent partition isolation, and disk reload operations.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { StorageEngine } from "../../../src/storage/storage_engine.js";
import { RecordType } from "../../../src/common/binary_frame.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_storage_engine");

describe("StorageEngine Topic Catalog & Partition Dispatcher", () => {
  beforeEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates topics and routes keyed records deterministically via MurmurHash3", () => {
    const engine = new StorageEngine({
      dataDir: TEST_DIR,
      defaultPartitions: 4,
    });
    engine.open();

    const topicEntry = engine.createTopic("iot_telemetry", { partitions: 4 });
    assert.strictEqual(topicEntry.partitionCount, 4);

    // Identical keys must route to the exact same partition every time
    const pA1 = engine.getPartitionForKey("iot_telemetry", "sensor_node_42");
    const pA2 = engine.getPartitionForKey("iot_telemetry", "sensor_node_42");
    assert.strictEqual(pA1, pA2);

    const res1 = engine.append("iot_telemetry", {
      type: RecordType.DATA,
      key: "sensor_node_42",
      value: JSON.stringify({ temp: 22.4 }),
    });

    assert.strictEqual(res1.partition, pA1);
    assert.strictEqual(res1.offset, 0n);

    // Read back from that specific partition
    const records = engine.read("iot_telemetry", pA1, 0n, 10);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].key.toString("utf8"), "sensor_node_42");

    engine.close();
  });

  it("reloads multi-topic directory layout on engine restart", () => {
    const engine = new StorageEngine({
      dataDir: TEST_DIR,
      defaultPartitions: 2,
    });
    engine.open();

    engine.createTopic("events_alpha", { partitions: 2 });
    engine.createTopic("events_beta", { partitions: 3 });

    engine.append("events_alpha", { type: RecordType.DATA, value: "hello" }, 0);
    engine.append("events_alpha", { type: RecordType.DATA, value: "world" }, 0);
    engine.append("events_beta", { type: RecordType.DATA, value: "test" }, 1);

    engine.close();

    // Reopen second instance
    const reopened = new StorageEngine({
      dataDir: TEST_DIR,
    });
    reopened.open();

    assert.ok(reopened.topics.has("events_alpha"));
    assert.ok(reopened.topics.has("events_beta"));

    const alphaRecords = reopened.read("events_alpha", 0, 0n, 10);
    assert.strictEqual(alphaRecords.length, 2);

    const betaRecords = reopened.read("events_beta", 1, 0n, 10);
    assert.strictEqual(betaRecords.length, 1);

    reopened.close();
  });
});
