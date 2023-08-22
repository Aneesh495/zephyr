#!/usr/bin/env node
/**
 * bin/zephyr-server.js
 *
 * Distributed standalone server daemon for Zephyr.
 * Boots the storage engine, TCP binary wire server, HTTP REST management gateway,
 * WebSocket pub/sub streamer, and worker thread pool.
 */

import path from "node:path";
import fs from "node:fs";
import { StorageEngine } from "../src/storage/storage_engine.js";
import { TcpServer } from "../src/net/tcp_server.js";
import { HttpServer } from "../src/net/http_server.js";
import { WebSocketServer } from "../src/net/ws_server.js";
import { WorkerPool } from "../src/concurrency/worker_pool.js";
import { globalMetrics } from "../common/metrics.js";

const DATA_DIR = process.env.ZEPHYR_DATA_DIR || path.join(process.cwd(), "data");
const TCP_PORT = parseInt(process.env.ZEPHYR_TCP_PORT || "9092", 10);
const HTTP_PORT = parseInt(process.env.ZEPHYR_HTTP_PORT || "8080", 10);

console.log(`
  ========================================================================
     ______ ______ _____  _    ___     ______ 
    |___  /|  ____|  __ \\| |  | \\ \\   / /  _ \\
       / / | |__  | |__) | |__| |\\ \\_/ /| |_) |
      / /  |  __| |  ___/|  __  | \\   / |  _ < 
     / /__ | |____| |    | |  | |  | |  | |_) |
    /_____||______|_|    |_|  |_|  |_|  |____/ 
    High-Throughput Distributed Stream-Relational Engine & CEP Kernel
  ========================================================================
`);

async function main() {
  console.log(`[Zephyr Kernel] Initializing storage engine in: ${DATA_DIR}`);
  const storageEngine = new StorageEngine({ dataDir: DATA_DIR });
  storageEngine.open();

  console.log(`[Zephyr Concurrency] Initializing multi-threaded worker pool...`);
  const workerPool = new WorkerPool();
  try {
    await workerPool.start();
    console.log(`[Zephyr Concurrency] Worker pool initialized with ${workerPool.size} background workers.`);
  } catch {
    console.log(`[Zephyr Concurrency] Running in single-thread in-process fallback mode.`);
  }

  console.log(`[Zephyr Network] Starting binary TCP server on port ${TCP_PORT}...`);
  const tcpServer = new TcpServer({ storageEngine, port: TCP_PORT });
  await tcpServer.start();
  console.log(`[Zephyr Network] TCP binary wire gateway listening on 127.0.0.1:${TCP_PORT}`);

  console.log(`[Zephyr Network] Starting HTTP REST & WebSocket gateway on port ${HTTP_PORT}...`);
  const httpServer = new HttpServer({ storageEngine, port: HTTP_PORT });
  await httpServer.start();

  const wsServer = new WebSocketServer(httpServer.server);
  console.log(`[Zephyr Network] HTTP REST API & Web Dashboard listening on http://127.0.0.1:${HTTP_PORT}`);

  // Broadcast telemetry metrics to connected WebSocket clients every second
  setInterval(() => {
    wsServer.broadcastMetrics(globalMetrics.snapshot());
  }, 1000).unref();

  console.log(`[Zephyr Kernel] Engine online and ready for high-throughput stream ingestion.`);

  const shutdown = async () => {
    console.log(`\n[Zephyr Kernel] Initiating graceful shutdown sequence...`);
    await tcpServer.close();
    await httpServer.close();
    await workerPool.close();
    storageEngine.close();
    console.log(`[Zephyr Kernel] Engine cleanly stopped. Exiting.`);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(`[FATAL] Zephyr server startup failed:`, err);
  process.exit(1);
});
