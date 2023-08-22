#!/usr/bin/env node
/**
 * bin/zephyr.js
 *
 * Unified CLI dispatcher for Zephyr.
 * Usage:
 *   zephyr server       Start standalone distributed engine daemon
 *   zephyr repl         Launch interactive Stream-SQL REPL
 *   zephyr --help       Show usage guide
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] || "server";

if (command === "server" || command === "start") {
  const child = spawn(process.execPath, [path.join(__dirname, "zephyr-server.js")], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code || 0));
} else if (command === "repl") {
  const child = spawn(process.execPath, [path.join(__dirname, "zephyr-repl.js")], {
    stdio: "inherit",
  });
  child.on("exit", (code) => process.exit(code || 0));
} else if (command === "--help" || command === "-h" || command === "help") {
  console.log(`
Zephyr CLI: High-Throughput Distributed Stream-Relational Engine & CEP Kernel

Usage:
  zephyr server       Start server daemon (TCP, HTTP REST, WebSocket, Storage)
  zephyr repl         Launch interactive Stream-SQL terminal
  zephyr --help       Show this guide
  `);
  process.exit(0);
} else {
  console.error(`Unknown command: ${command}. Run 'zephyr --help' for usage.`);
  process.exit(1);
}
