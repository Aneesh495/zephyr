/**
 * test/unit/common/crc32c.test.js
 *
 * Verifies Castagnoli CRC32C checksum correctness against RFC 3720 test vectors
 * and checks incremental update equivalence and boundary conditions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32c, crc32cUpdate, crc32cHex } from "../../../src/common/crc32c.js";

describe("Castagnoli CRC32C Checksum Engine", () => {
  it("computes empty buffer checksum as 0x00000000", () => {
    const empty = Buffer.alloc(0);
    const result = crc32c(empty);
    assert.strictEqual(result, 0);
    assert.strictEqual(crc32cHex(result), "0x00000000");
  });

  it("matches standard ASCII test vector '123456789'", () => {
    // Standard CRC-32C vector for ASCII string "123456789" is 0xE3069283
    const data = Buffer.from("123456789", "utf8");
    const result = crc32c(data);
    assert.strictEqual(result, 0xE3069283 >>> 0);
    assert.strictEqual(crc32cHex(result), "0xE3069283");
  });

  it("matches RFC 3720 32-byte zero vector", () => {
    // RFC 3720 Section 8.4: 32 bytes of 0x00 results in 0x8A9136AA
    const data = Buffer.alloc(32, 0x00);
    const result = crc32c(data);
    assert.strictEqual(result, 0x8A9136AA >>> 0);
    assert.strictEqual(crc32cHex(result), "0x8A9136AA");
  });

  it("matches RFC 3720 32-byte 0xFF vector", () => {
    // RFC 3720 Section 8.4: 32 bytes of 0xFF results in 0x62A8AB43
    const data = Buffer.alloc(32, 0xFF);
    const result = crc32c(data);
    assert.strictEqual(result, 0x62A8AB43 >>> 0);
    assert.strictEqual(crc32cHex(result), "0x62A8AB43");
  });

  it("produces identical results for contiguous vs incremental updates", () => {
    const data = Buffer.from("The quick brown fox jumps over the lazy dog", "utf8");
    const full = crc32c(data);

    // Split in two chunks
    const chunk1 = data.subarray(0, 16);
    const chunk2 = data.subarray(16);

    const step1 = crc32c(chunk1);
    const step2 = crc32cUpdate(step1, chunk2);

    assert.strictEqual(step2, full);
  });

  it("correctly respects offset and length parameters", () => {
    const payload = Buffer.from("PREFIX_123456789_SUFFIX", "utf8");
    const sub = crc32c(payload, 7, 9);
    assert.strictEqual(sub, 0xE3069283 >>> 0);
  });

  it("handles unaligned buffer lengths across the sliced-by-8 boundary", () => {
    for (let len = 1; len <= 65; len++) {
      const buf = Buffer.alloc(len, 0x42);
      const res = crc32c(buf);
      assert.strictEqual(typeof res, "number");
      assert.ok(res >= 0 && res <= 0xFFFFFFFF);
    }
  });
});
