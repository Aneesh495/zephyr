/**
 * test/unit/client/client.test.js
 *
 * Verifies ZephyrClient facade, buffered producer micro-batching,
 * and polling consumer stream iteration.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { StorageEngine } from "../../../src/storage/storage_engine.js";
import { TcpServer } from "../../../src/net/tcp_server.js";
import { ZephyrClient } from "../../../src/client/client.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_client_sdk");
const PORT = 19095;

describe("Zephyr Node.js Client SDK", () => {
  let engine;
  let server;
  let client;

  beforeEach(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });

    engine = new StorageEngine({ dataDir: TEST_DIR, defaultPartitions: 2 });
    engine.open();

    server = new TcpServer({ storageEngine: engine, port: PORT });
    await server.start();

    client = new ZephyrClient({ port: PORT });
    await client.connect();
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    engine.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("produces records via buffered producer and polls records via consumer", async () => {
    const producer = client.producer({ lingerMs: 2 });
    const consumer = client.consumer("analytics", { partition: 0 });

    const p1 = producer.send("analytics", { action: "PAGE_VIEW", path: "/home" }, "user-1", 0);
    const p2 = producer.send("analytics", { action: "CLICK", target: "btn-signup" }, "user-1", 0);

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1.status, "OK");
    assert.strictEqual(r2.status, "OK");

    const polled = await consumer.poll(10);
    assert.strictEqual(polled.length, 2);
    assert.strictEqual(polled[0].key, "user-1");
    assert.strictEqual(JSON.parse(polled[0].value).action, "PAGE_VIEW");

    await producer.close();
    consumer.close();
  });
});
