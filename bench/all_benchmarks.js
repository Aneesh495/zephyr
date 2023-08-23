/**
 * bench/all_benchmarks.js
 *
 * Microbenchmark suite for Zephyr performance profiling.
 * Measures CRC32C throughput, lock-free ring buffer operations,
 * WAL segment appends, and CEP pattern matching latency.
 */

import fs from "node:fs";
import path from "node:path";
import { crc32c } from "../src/common/crc32c.js";
import { murmur3_32 } from "../src/common/murmur3.js";
import { SPSCQueue, MPMCQueue } from "../src/concurrency/ring_buffer.js";
import { LogSegment } from "../src/storage/segment.js";
import { Lexer } from "../src/sql/lexer.js";
import { Parser } from "../src/sql/parser.js";
import { Pattern } from "../src/cep/pattern.js";
import { CEPMatcher } from "../src/cep/matcher.js";

function formatNumber(num) {
  return num.toLocaleString();
}

function runBenchmark(name, iterations, fn) {
  // Warmup pass
  for (let i = 0; i < Math.min(1000, iterations); i++) fn();

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = process.hrtime.bigint();

  const elapsedNanos = Number(end - start);
  const elapsedSeconds = elapsedNanos / 1e9;
  const opsPerSec = Math.floor(iterations / elapsedSeconds);
  const nsPerOp = (elapsedNanos / iterations).toFixed(2);

  return { name, iterations, opsPerSec, nsPerOp };
}

async function main() {
  console.log(`
  ========================================================================
     Zephyr Microbenchmark Suite // Apple Silicon & V8 Native Optimization
  ========================================================================
  `);

  const results = [];

  // 1. Castagnoli CRC32C Checksum (4KB buffer)
  const testBuf = Buffer.alloc(4096, 0x42);
  results.push(runBenchmark("Castagnoli CRC32C (4KB Chunk)", 50000, () => {
    crc32c(testBuf);
  }));

  // 2. MurmurHash3 32-Bit
  const hashKey = "sensor_stream_key_99999";
  results.push(runBenchmark("MurmurHash3 32-Bit Hashing", 200000, () => {
    murmur3_32(hashKey);
  }));

  // 3. Lock-Free SPSC Ring Buffer
  const spsc = new SPSCQueue(1024);
  results.push(runBenchmark("Lock-Free SPSC Ring Buffer (Offer+Poll)", 500000, () => {
    spsc.offer(42);
    spsc.poll();
  }));

  // 4. Lock-Free MPMC Queue
  const mpmc = new MPMCQueue(1024);
  results.push(runBenchmark("Lock-Free MPMC Queue (Offer+Poll)", 200000, () => {
    mpmc.offer(42);
    mpmc.poll();
  }));

  // 5. Append-Only Segment Framing & Append
  const tmpDir = path.join(process.cwd(), "tmp", "bench_seg");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const seg = new LogSegment({ directory: tmpDir, baseOffset: 0n });
  seg.open();
  const testPayload = { key: "device_01", value: "{\"temp\": 24.5}" };

  results.push(runBenchmark("WAL Segment Append & 64B Framing", 50000, () => {
    seg.append(testPayload);
  }));
  seg.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 6. Stream-SQL Lexer & Parser
  const sql = "SELECT symbol, COUNT(*) FROM trades GROUP BY symbol, WINDOW(TUMBLING, SIZE 5 SECONDS);";
  results.push(runBenchmark("Stream-SQL Lexer & Parser Compilation", 20000, () => {
    const tokens = new Lexer(sql).tokenize();
    new Parser(tokens).parse();
  }));

  // 7. CEP Pattern Matcher Execution
  const pattern = Pattern.begin("A").where((e) => e.v === 1).next("B").where((e) => e.v === 2);
  const matcher = new CEPMatcher(pattern);
  const evt = { v: 1, timestamp: 1000n };
  results.push(runBenchmark("CEP NFA-e State Machine Transition", 100000, () => {
    matcher.process(evt);
  }));

  // Display Table
  console.log(
    "+---------------------------------------+---------------+------------------+--------------+"
  );
  console.log(
    "| Benchmark Subsystem                   | Iterations    | Ops / Second     | Latency      |"
  );
  console.log(
    "+---------------------------------------+---------------+------------------+--------------+"
  );
  for (const r of results) {
    const name = r.name.padEnd(37, " ");
    const iters = formatNumber(r.iterations).padStart(13, " ");
    const ops = `${formatNumber(r.opsPerSec)} ops/s`.padStart(16, " ");
    const lat = `${r.nsPerOp} ns`.padStart(12, " ");
    console.log(`| ${name} | ${iters} | ${ops} | ${lat} |`);
  }
  console.log(
    "+---------------------------------------+---------------+------------------+--------------+\n"
  );
}

main().catch(console.error);
