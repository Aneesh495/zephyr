/**
 * src/net/http_server.js
 *
 * RESTful HTTP/1.1 management and ingestion gateway for Zephyr.
 * Provides endpoints for topic creation, record production, partition inspection,
 * Stream-SQL query compilation, and live Prometheus/JSON telemetry metrics.
 */

import http from "node:http";
import { Lexer } from "../sql/lexer.js";
import { Parser } from "../sql/parser.js";
import { QueryOptimizer } from "../sql/optimizer.js";
import { globalMetrics } from "../common/metrics.js";

export class HttpServer {
  /**
   * @param {object} options
   * @param {import('../storage/storage_engine.js').StorageEngine} options.storageEngine
   * @param {number} [options.port=8080]
   * @param {string} [options.host="127.0.0.1"]
   */
  constructor({ storageEngine, port = 8080, host = "127.0.0.1" }) {
    this.storageEngine = storageEngine;
    this.port = port;
    this.host = host;
    this.server = null;
    this.optimizer = new QueryOptimizer();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  _sendJson(res, statusCode, data) {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
      "Connection": "close",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    });
    res.end(json);
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          resolve(body.length > 0 ? JSON.parse(body) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", (err) => reject(err));
    });
  }

  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Connection": "close",
      });
      res.end();
      return;
    }

    try {
      // Health check
      if (method === "GET" && pathname === "/health") {
        return this._sendJson(res, 200, { status: "UP", timestamp: Date.now() });
      }

      // Telemetry metrics
      if (method === "GET" && pathname === "/api/v1/metrics") {
        return this._sendJson(res, 200, globalMetrics.snapshot());
      }

      // List topics
      if (method === "GET" && pathname === "/api/v1/topics") {
        const topics = [];
        for (const [name, entry] of this.storageEngine.topics) {
          topics.push({
            name,
            partitionCount: entry.partitionCount,
            compacted: entry.compacted,
          });
        }
        return this._sendJson(res, 200, { topics });
      }

      // Produce record: POST /api/v1/topics/:topic/produce
      const produceMatch = pathname.match(/^\/api\/v1\/topics\/([^/]+)\/produce$/);
      if (method === "POST" && produceMatch) {
        const topic = produceMatch[1];
        const body = await this._readBody(req);
        const { key, value, partition } = body;

        const result = this.storageEngine.append(topic, {
          key,
          value: typeof value === "object" ? JSON.stringify(value) : String(value),
        }, partition);

        globalMetrics.counter("zephyr_records_produced_total").inc(1);

        return this._sendJson(res, 200, {
          status: "SUCCESS",
          topic: result.topic,
          partition: result.partition,
          offset: result.offset.toString(),
          timestamp: result.timestamp.toString(),
        });
      }

      // Read records: GET /api/v1/topics/:topic/partitions/:partition/records
      const readMatch = pathname.match(/^\/api\/v1\/topics\/([^/]+)\/partitions\/(\d+)\/records$/);
      if (method === "GET" && readMatch) {
        const topic = readMatch[1];
        const partition = parseInt(readMatch[2], 10);
        const offset = BigInt(url.searchParams.get("offset") || "0");
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);

        const records = this.storageEngine.read(topic, partition, offset, limit);
        const serialized = records.map((r) => ({
          offset: r.offset.toString(),
          timestamp: r.timestamp.toString(),
          key: r.key.toString("utf8"),
          value: r.value.toString("utf8"),
        }));

        return this._sendJson(res, 200, { records: serialized });
      }

      // Execute Stream-SQL query plan: POST /api/v1/sql
      if (method === "POST" && pathname === "/api/v1/sql") {
        const body = await this._readBody(req);
        const query = body.query;
        if (!query) {
          return this._sendJson(res, 400, { error: "Missing query field in request body" });
        }

        const tokens = new Lexer(query).tokenize();
        const ast = new Parser(tokens).parse();
        const plan = this.optimizer.optimize(ast);

        return this._sendJson(res, 200, {
          status: "OPTIMIZED",
          plan: {
            source: plan.source,
            requiredColumns: Array.from(plan.requiredColumns),
            isAggregate: plan.isAggregate,
            aggregations: plan.aggregations,
            window: plan.window,
            emitMode: plan.emitMode,
          },
        });
      }

      // 404 Not Found
      return this._sendJson(res, 404, { error: `Endpoint ${pathname} not found` });
    } catch (err) {
      return this._sendJson(res, 500, { error: err.message });
    }
  }

  close() {
    return new Promise((resolve) => {
      if (this.server) {
        if (typeof this.server.closeAllConnections === "function") {
          this.server.closeAllConnections();
        }
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
