/**
 * test/unit/net/http_ws.test.js
 *
 * Verifies RESTful HTTP ingestion, partition slice queries,
 * Stream-SQL query plan generation, and telemetry metrics endpoints.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { StorageEngine } from "../../../src/storage/storage_engine.js";
import { HttpServer } from "../../../src/net/http_server.js";

const TEST_DIR = path.join(process.cwd(), "tmp", "test_http");
const PORT = 18080;

function httpRequest(options, postData = null) {
  const reqHeaders = {
    Connection: "close",
    ...(options.headers || {}),
  };

  const payload = postData
    ? (typeof postData === "string" ? postData : JSON.stringify(postData))
    : null;

  if (payload) {
    reqHeaders["Content-Length"] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request({ ...options, headers: reqHeaders }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: body.length > 0 ? JSON.parse(body) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("RESTful HTTP Ingestion & Management Gateway", () => {
  let engine;
  let server;

  beforeEach(async () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    fs.mkdirSync(TEST_DIR, { recursive: true });

    engine = new StorageEngine({ dataDir: TEST_DIR, defaultPartitions: 2 });
    engine.open();

    server = new HttpServer({ storageEngine: engine, port: PORT });
    await server.start();
  });

  afterEach(async () => {
    await server.close();
    engine.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("produces records via POST /api/v1/topics/:topic/produce and reads them back", async () => {
    const produceRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/v1/topics/sensor_stream/produce",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        key: "sensor_alpha",
        value: { temperature: 28.4, pressure: 101.3 },
        partition: 0,
      }
    );

    assert.strictEqual(produceRes.status, 200);
    assert.strictEqual(produceRes.body.status, "SUCCESS");
    assert.strictEqual(produceRes.body.partition, 0);

    const readRes = await httpRequest({
      hostname: "127.0.0.1",
      port: PORT,
      path: "/api/v1/topics/sensor_stream/partitions/0/records?offset=0&limit=10",
      method: "GET",
    });

    assert.strictEqual(readRes.status, 200);
    assert.strictEqual(readRes.body.records.length, 1);
    assert.strictEqual(readRes.body.records[0].key, "sensor_alpha");
  });

  it("compiles Stream-SQL query to physical plan via POST /api/v1/sql", async () => {
    const sqlRes = await httpRequest(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/api/v1/sql",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        query: "SELECT symbol, COUNT(*) AS cnt FROM trades GROUP BY symbol, WINDOW(TUMBLING, SIZE 10 SECONDS);",
      }
    );

    assert.strictEqual(sqlRes.status, 200);
    assert.strictEqual(sqlRes.body.status, "OPTIMIZED");
    assert.strictEqual(sqlRes.body.plan.source, "trades");
    assert.strictEqual(sqlRes.body.plan.isAggregate, true);
    assert.strictEqual(sqlRes.body.plan.window.windowType, "TUMBLING");
  });
});
