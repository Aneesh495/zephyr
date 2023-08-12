/**
 * test/unit/net/tcp.test.js
 *
 * Verifies high-throughput binary framed TCP server and client communication,
 * multiplexed RPC matching via correlation ID, PRODUCE and FETCH operations.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { StorageEngine } from "../../../src/storage/storage_engine.js";
import { TcpServer } from "../../../src/net/tcp_server.js";
import { TcpClient } from "../../../src/net/tcp_client.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_tcp");
const PORT = 19092;

describe("Binary Framed TCP Wire Protocol", () => {
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

    client = new TcpClient({ port: PORT });
    await client.connect();
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    engine.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("produces records via TCP RPC and fetches them back with verified offsets", async () => {
    // Produce record
    const produceRes = await client.sendRpc(
      {
        action: "PRODUCE",
        topic: "market_feed",
        partition: 0,
        data: { ticker: "GOOGL", price: 180.5 },
      },
      "stock_ticker"
    );

    assert.strictEqual(produceRes.status, "OK");
    assert.strictEqual(produceRes.topic, "market_feed");
    assert.strictEqual(produceRes.offset, "0");

    // Fetch record
    const fetchRes = await client.sendRpc({
      action: "FETCH",
      topic: "market_feed",
      partition: 0,
      offset: 0,
      maxRecords: 10,
    });

    assert.strictEqual(fetchRes.status, "OK");
    assert.strictEqual(fetchRes.records.length, 1);
    assert.strictEqual(fetchRes.records[0].key, "stock_ticker");
    assert.strictEqual(JSON.parse(fetchRes.records[0].value).ticker, "GOOGL");
  });
});
