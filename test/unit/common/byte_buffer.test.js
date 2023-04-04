/**
 * test/unit/common/byte_buffer.test.js
 *
 * Verifies ByteBuffer read/write primitives, dynamic buffer expansion,
 * Varint codecs, and power-of-two slab pool recycling.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ByteBuffer, BufferPool } from "../../../src/common/byte_buffer.js";

describe("ByteBuffer & Slab BufferPool", () => {
  it("writes and reads primitive numerical types correctly", () => {
    const bb = new ByteBuffer(16);
    bb.writeUint8(0xFE);
    bb.writeUint16LE(0x1234);
    bb.writeUint32LE(0xDEADBEEF);
    bb.writeInt32LE(-987654);
    bb.writeBigInt64LE(-1234567890123456789n);
    bb.writeBigUInt64LE(18446744073709551615n);
    bb.writeFloat64LE(3.141592653589793);

    assert.strictEqual(bb.readUint8(), 0xFE);
    assert.strictEqual(bb.readUint16LE(), 0x1234);
    assert.strictEqual(bb.readUint32LE(), 0xDEADBEEF);
    assert.strictEqual(bb.readInt32LE(), -987654);
    assert.strictEqual(bb.readBigInt64LE(), -1234567890123456789n);
    assert.strictEqual(bb.readBigUInt64LE(), 18446744073709551615n);
    assert.ok(Math.abs(bb.readFloat64LE() - 3.141592653589793) < 1e-12);
  });

  it("dynamically doubles capacity on exceeding buffer limits", () => {
    const bb = new ByteBuffer(64);
    const initialCapacity = bb.capacity;

    const largeData = Buffer.alloc(500, 0xAB);
    bb.writeBytes(largeData);

    assert.ok(bb.capacity > initialCapacity);
    assert.strictEqual(bb.writeCursor, 500);

    const out = Buffer.alloc(500);
    bb.buffer.copy(out, 0, 0, 500);
    assert.deepStrictEqual(out, largeData);
  });

  it("encodes and decodes multi-byte Varint32 LEB128 numbers", () => {
    const testCases = [0, 1, 127, 128, 255, 300, 16384, 2097151, 2097152, 268435455, 4294967295];
    const bb = new ByteBuffer(64);

    for (const val of testCases) {
      bb.writeVarint32(val);
    }

    for (const val of testCases) {
      assert.strictEqual(bb.readVarint32(), val);
    }
  });

  it("encodes and decodes length-prefixed strings", () => {
    const bb = new ByteBuffer();
    bb.writeString("Zephyr distributed stream engine");
    bb.writeString("Symbols: @#$%^&*()_+~`");

    assert.strictEqual(bb.readString(), "Zephyr distributed stream engine");
    assert.strictEqual(bb.readString(), "Symbols: @#$%^&*()_+~`");
  });

  it("recycles buffers in power-of-two buckets via BufferPool", () => {
    const pool = new BufferPool(16);
    const buf1 = pool.acquire(200); // rounds to 256
    assert.strictEqual(buf1.capacity, 256);

    buf1.writeUint32LE(0xCAFEBABE);
    pool.release(buf1);

    const buf2 = pool.acquire(200);
    assert.strictEqual(buf2, buf1, "Reacquired buffer must be recycled instance");
    assert.strictEqual(buf2.writeCursor, 0, "Recycled buffer must have cursor reset");
  });
});
