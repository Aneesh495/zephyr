/**
 * test/unit/common/murmur3.test.js
 *
 * Verifies MurmurHash3 32-bit and 128-bit hash distributions, avalanche characteristics,
 * seed consistency, and buffer/string parity.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { murmur3_32, murmur3_128 } from "../../../src/common/murmur3.js";

describe("MurmurHash3 32-Bit & 128-Bit Engine", () => {
  it("computes deterministic 32-bit hash for empty input", () => {
    const hash = murmur3_32("", 0);
    assert.strictEqual(hash, 0);
  });

  it("yields identical 32-bit results for Buffer and string representations", () => {
    const text = "zephyr_stream_partition_key_01";
    const strHash = murmur3_32(text, 12345);
    const bufHash = murmur3_32(Buffer.from(text, "utf8"), 12345);
    assert.strictEqual(strHash, bufHash);
  });

  it("produces distinct hashes across different seed values", () => {
    const text = "order_events_topic";
    const hash1 = murmur3_32(text, 0);
    const hash2 = murmur3_32(text, 1);
    assert.notStrictEqual(hash1, hash2);
  });

  it("satisfies avalanche property where 1-bit input flip alters multiple output bits", () => {
    const base = Buffer.from("user_account_identifier_9999999", "utf8");
    const mutated = Buffer.from(base);
    mutated[base.length - 1] ^= 0x01; // flip 1 bit

    const h1 = murmur3_32(base, 0);
    const h2 = murmur3_32(mutated, 0);

    const diff = (h1 ^ h2) >>> 0;
    // Count set bits in XOR difference (Hamming distance)
    let bitCount = 0;
    let temp = diff;
    while (temp > 0) {
      bitCount += temp & 1;
      temp >>>= 1;
    }

    // Good hash function flips ~16 out of 32 bits, must be at least 8
    assert.ok(bitCount >= 8, `Avalanche bit count was ${bitCount}, expected >= 8`);
  });

  it("computes deterministic 128-bit hash buffer", () => {
    const text = "distributed_consensus_state_machine";
    const digest1 = murmur3_128(text, 42);
    const digest2 = murmur3_128(Buffer.from(text, "utf8"), 42);

    assert.strictEqual(digest1.length, 16);
    assert.deepStrictEqual(digest1, digest2);
  });
});
