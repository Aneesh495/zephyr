#!/usr/bin/env node
/**
 * bin/zephyr-repl.js
 *
 * Interactive Stream-SQL Read-Eval-Print Loop (REPL) for Zephyr.
 * Enables live stream queries, AST and physical plan inspection, and cluster administration.
 */

import readline from "node:readline";
import { Lexer } from "../src/sql/lexer.js";
import { Parser } from "../src/sql/parser.js";
import { QueryOptimizer } from "../src/sql/optimizer.js";
import { globalMetrics } from "../src/common/metrics.js";

const optimizer = new QueryOptimizer();

console.log(`
  ========================================================================
     ______ ______ _____  _    ___     ______ 
    |___  /|  ____|  __ \\| |  | \\ \\   / /  _ \\
       / / | |__  | |__) | |__| |\\ \\_/ /| |_) |
      / /  |  __| |  ___/|  __  | \\   / |  _ < 
     / /__ | |____| |    | |  | |  | |  | |_) |
    /_____||______|_|    |_|  |_|  |_|  |____/ 
    Interactive Stream-SQL REPL
    Type .help for commands, .exit to quit.
  ========================================================================
`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "zephyr-sql> ",
});

rl.prompt();

rl.on("line", (line) => {
  const trimmed = line.trim();

  if (!trimmed) {
    rl.prompt();
    return;
  }

  if (trimmed === ".exit" || trimmed === ".quit") {
    console.log("Exiting Zephyr REPL. Goodbye.");
    process.exit(0);
  }

  if (trimmed === ".help") {
    console.log(`
Available commands:
  .help               Show this help message
  .metrics            Display current telemetry metrics snapshot
  .exit               Exit REPL

Stream-SQL Example:
  SELECT symbol, COUNT(*) AS count, AVG(price) AS vwap
  FROM trades
  WHERE price > 100.0
  GROUP BY symbol, WINDOW(TUMBLING, SIZE 10 SECONDS)
  EMIT CHANGES;
    `);
    rl.prompt();
    return;
  }

  if (trimmed === ".metrics") {
    console.log(JSON.stringify(globalMetrics.snapshot(), null, 2));
    rl.prompt();
    return;
  }

  try {
    const tokens = new Lexer(trimmed).tokenize();
    const ast = new Parser(tokens).parse();
    const plan = optimizer.optimize(ast);

    console.log("\n[Parsed Physical Execution Plan]:");
    console.log(JSON.stringify(plan, (key, value) => {
      if (value instanceof Set) return Array.from(value);
      if (typeof value === "bigint") return value.toString();
      return value;
    }, 2));
    console.log("");
  } catch (err) {
    console.error(`[Error]: ${err.message}`);
  }

  rl.prompt();
});

rl.on("close", () => {
  console.log("\nExiting Zephyr REPL.");
  process.exit(0);
});
