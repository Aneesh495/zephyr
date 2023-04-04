/**
 * src/common/byte_buffer.js
 *
 * High-performance, endian-aware, auto-growing ByteBuffer with Varint codecs
 * and power-of-two slab buffer pooling to eliminate V8 garbage collection churn.
 */

export class ByteBuffer {
  /**
   * @param {number|Buffer} [initial=1024] Initial capacity or underlying Buffer
   */
  constructor(initial = 1024) {
    if (Buffer.isBuffer(initial)) {
      this.buffer = initial;
      this.capacity = initial.length;
      this.writeCursor = initial.length;
    } else {
      this.capacity = Math.max(initial, 64);
      this.buffer = Buffer.allocUnsafe(this.capacity);
      this.writeCursor = 0;
    }
    this.readCursor = 0;
  }

  /**
   * Ensures that the buffer has at least the specified additional capacity.
   * Doubles capacity if expansion is required.
   *
   * @param {number} additionalBytes Required free space
   */
  ensureCapacity(additionalBytes) {
    const required = this.writeCursor + additionalBytes;
    if (required <= this.capacity) {
      return;
    }

    let nextCapacity = this.capacity;
    while (nextCapacity < required) {
      nextCapacity = nextCapacity * 2;
    }

    const nextBuffer = Buffer.allocUnsafe(nextCapacity);
    this.buffer.copy(nextBuffer, 0, 0, this.writeCursor);
    this.buffer = nextBuffer;
    this.capacity = nextCapacity;
  }

  writeUint8(val) {
    this.ensureCapacity(1);
    this.buffer.writeUInt8(val, this.writeCursor);
    this.writeCursor += 1;
    return this;
  }

  readUint8() {
    const val = this.buffer.readUInt8(this.readCursor);
    this.readCursor += 1;
    return val;
  }

  writeUint16LE(val) {
    this.ensureCapacity(2);
    this.buffer.writeUInt16LE(val, this.writeCursor);
    this.writeCursor += 2;
    return this;
  }

  readUint16LE() {
    const val = this.buffer.readUInt16LE(this.readCursor);
    this.readCursor += 2;
    return val;
  }

  writeUint32LE(val) {
    this.ensureCapacity(4);
    this.buffer.writeUInt32LE(val, this.writeCursor);
    this.writeCursor += 4;
    return this;
  }

  readUint32LE() {
    const val = this.buffer.readUInt32LE(this.readCursor);
    this.readCursor += 4;
    return val;
  }

  writeInt32LE(val) {
    this.ensureCapacity(4);
    this.buffer.writeInt32LE(val, this.writeCursor);
    this.writeCursor += 4;
    return this;
  }

  readInt32LE() {
    const val = this.buffer.readInt32LE(this.readCursor);
    this.readCursor += 4;
    return val;
  }

  writeBigInt64LE(val) {
    this.ensureCapacity(8);
    this.buffer.writeBigInt64LE(BigInt(val), this.writeCursor);
    this.writeCursor += 8;
    return this;
  }

  readBigInt64LE() {
    const val = this.buffer.readBigInt64LE(this.readCursor);
    this.readCursor += 8;
    return val;
  }

  writeBigUInt64LE(val) {
    this.ensureCapacity(8);
    this.buffer.writeBigUInt64LE(BigInt(val), this.writeCursor);
    this.writeCursor += 8;
    return this;
  }

  readBigUInt64LE() {
    const val = this.buffer.readBigUInt64LE(this.readCursor);
    this.readCursor += 8;
    return val;
  }

  writeFloat64LE(val) {
    this.ensureCapacity(8);
    this.buffer.writeDoubleLE(val, this.writeCursor);
    this.writeCursor += 8;
    return this;
  }

  readFloat64LE() {
    const val = this.buffer.readDoubleLE(this.readCursor);
    this.readCursor += 8;
    return val;
  }

  /**
   * Writes a Variable-length Quantity (LEB128 32-bit unsigned integer).
   *
   * @param {number} value
   */
  writeVarint32(value) {
    let v = value >>> 0;
    while (v >= 0x80) {
      this.writeUint8((v & 0x7F) | 0x80);
      v >>>= 7;
    }
    this.writeUint8(v & 0x7F);
    return this;
  }

  /**
   * Reads a Variable-length Quantity (LEB128 32-bit unsigned integer).
   *
   * @returns {number}
   */
  readVarint32() {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readUint8();
      result |= (byte & 0x7F) << shift;
      if ((byte & 0x80) === 0) {
        break;
      }
      shift += 7;
      if (shift >= 35) {
        throw new Error("Varint32 overflow: more than 5 bytes in stream");
      }
    }
    return result >>> 0;
  }

  /**
   * Writes a UTF-8 string with leading Varint32 byte length prefix.
   *
   * @param {string} str
   */
  writeString(str) {
    const strBytes = Buffer.from(str, "utf8");
    this.writeVarint32(strBytes.length);
    this.writeBytes(strBytes);
    return this;
  }

  /**
   * Reads a length-prefixed UTF-8 string.
   *
   * @returns {string}
   */
  readString() {
    const length = this.readVarint32();
    const str = this.buffer.toString("utf8", this.readCursor, this.readCursor + length);
    this.readCursor += length;
    return str;
  }

  /**
   * Appends raw bytes into the buffer.
   *
   * @param {Buffer|Uint8Array} src
   * @param {number} [offset=0]
   * @param {number} [length]
   */
  writeBytes(src, offset = 0, length = undefined) {
    const len = length !== undefined ? length : (src.length - offset);
    this.ensureCapacity(len);
    src.copy(this.buffer, this.writeCursor, offset, offset + len);
    this.writeCursor += len;
    return this;
  }

  /**
   * Slices out a copy or view of the written bytes.
   *
   * @returns {Buffer}
   */
  toBuffer() {
    return this.buffer.subarray(0, this.writeCursor);
  }

  reset() {
    this.writeCursor = 0;
    this.readCursor = 0;
    return this;
  }

  remaining() {
    return Math.max(0, this.writeCursor - this.readCursor);
  }
}

/**
 * Power-of-two slab pool to recycle byte buffers across concurrent operations.
 */
export class BufferPool {
  /**
   * @param {number} [maxPooledPerBucket=64]
   */
  constructor(maxPooledPerBucket = 64) {
    this.maxPooledPerBucket = maxPooledPerBucket;
    this.buckets = new Map();
  }

  _getBucketKey(size) {
    let p = 64;
    while (p < size) {
      p <<= 1;
    }
    return p;
  }

  /**
   * Acquires a ByteBuffer from the pool or allocates a new one.
   *
   * @param {number} minCapacity
   * @returns {ByteBuffer}
   */
  acquire(minCapacity) {
    const bucketKey = this._getBucketKey(minCapacity);
    const bucket = this.buckets.get(bucketKey);
    if (bucket && bucket.length > 0) {
      const buf = bucket.pop();
      buf.reset();
      return buf;
    }
    return new ByteBuffer(bucketKey);
  }

  /**
   * Returns a ByteBuffer to the pool for reuse.
   *
   * @param {ByteBuffer} buf
   */
  release(buf) {
    const bucketKey = this._getBucketKey(buf.capacity);
    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      this.buckets.set(bucketKey, bucket);
    }
    if (bucket.length < this.maxPooledPerBucket) {
      buf.reset();
      bucket.push(buf);
    }
  }
}
