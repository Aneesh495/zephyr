/**
 * test/unit/common/binary_frame.test.js
 *
 * Verifies 64-byte aligned binary wire framing, round-trip serialization,
 * CRC32C validation, corruption detection, and boundary conditions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeFrame,
  decodeFrame,
  FRAME_MAGIC,
  HEADER_SIZE,
  RecordType,
  FrameFlags,
} from "../../../src/common/binary_frame.js";

describe("64-Byte Aligned Binary Wire Frame Codec", () => {
  it("encodes and decodes a complete record preserving all fields", () => {
    const original = {
      type: RecordType.DATA,
      flags: FrameFlags.NONE,
      offset: 1048576n,
      timestamp: 1710000000000n,
      correlationId: 42n,
      key: "sensor_alpha",
      metadata: JSON.stringify({ schema: "v1", compression: "none" }),
      value: JSON.stringify({ temperature: 24.5, humidity: 60.2 }),
    };

    const encoded = encodeFrame(original);
    assert.ok(encoded.length >= HEADER_SIZE);
    assert.strictEqual(encoded.length % 8, 0, "Frame size must be 8-byte aligned");

    const decoded = decodeFrame(encoded);
    assert.strictEqual(decoded.type, RecordType.DATA);
    assert.strictEqual(decoded.flags, FrameFlags.NONE);
    assert.strictEqual(decoded.offset, 1048576n);
    assert.strictEqual(decoded.timestamp, 1710000000000n);
    assert.strictEqual(decoded.correlationId, 42n);
    assert.strictEqual(decoded.key.toString("utf8"), "sensor_alpha");
    assert.strictEqual(
      JSON.parse(decoded.metadata.toString("utf8")).schema,
      "v1"
    );
    assert.strictEqual(
      JSON.parse(decoded.value.toString("utf8")).temperature,
      24.5
    );
  });

  it("handles records with null and empty payloads gracefully", () => {
    const minimal = {
      type: RecordType.WATERMARK,
      offset: 12n,
      timestamp: 1000n,
    };

    const encoded = encodeFrame(minimal);
    assert.strictEqual(encoded.length, HEADER_SIZE);

    const decoded = decodeFrame(encoded);
    assert.strictEqual(decoded.type, RecordType.WATERMARK);
    assert.strictEqual(decoded.offset, 12n);
    assert.strictEqual(decoded.key.length, 0);
    assert.strictEqual(decoded.metadata.length, 0);
    assert.strictEqual(decoded.value.length, 0);
  });

  it("detects single-bit payload corruption via CRC32C validation", () => {
    const record = {
      type: RecordType.DATA,
      offset: 99n,
      value: "critical_financial_transaction",
    };

    const encoded = encodeFrame(record);
    // Corrupt one byte in the value section (past header)
    encoded[HEADER_SIZE + 5] ^= 0x01;

    assert.throws(
      () => decodeFrame(encoded),
      /CRC32C checksum mismatch/,
      "Must reject corrupt frame payload"
    );
  });

  it("detects header field tampering via CRC32C validation", () => {
    const record = {
      type: RecordType.DATA,
      offset: 500n,
      value: "hello world",
    };

    const encoded = encodeFrame(record);
    // Tamper with offset field in header [16..23]
    encoded[16] ^= 0xFF;

    assert.throws(
      () => decodeFrame(encoded),
      /CRC32C checksum mismatch/,
      "Must reject corrupt frame header"
    );
  });

  it("rejects invalid magic bytes immediately", () => {
    const buffer = Buffer.alloc(HEADER_SIZE);
    buffer.writeUInt32LE(0xDEADBEEF, 0);

    assert.throws(
      () => decodeFrame(buffer),
      /Invalid frame magic/,
      "Must reject unknown magic identifier"
    );
  });

  it("rejects truncated frames when available bytes are less than total size", () => {
    const record = {
      type: RecordType.DATA,
      value: Buffer.alloc(128, 0xAA),
    };

    const encoded = encodeFrame(record);
    const truncated = encoded.subarray(0, HEADER_SIZE + 32);

    assert.throws(
      () => decodeFrame(truncated),
      /Incomplete frame payload/,
      "Must reject truncated frame"
    );
  });
});
