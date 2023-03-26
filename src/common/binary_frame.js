/**
 * src/common/binary_frame.js
 *
 * 64-byte cache-line aligned binary wire frame codec for Zephyr.
 * Used uniformly across the WAL storage engine, network transport, and lock-free ring buffers.
 *
 * Binary Layout:
 * [00..03] Magic Bytes: 0x5A455048 ("ZEPH")
 * [04..07] Payload Length: uint32 little-endian
 * [08..11] Checksum: Castagnoli CRC32C uint32 over header[12..63] and payload body
 * [12..13] Record Type: uint16 (DATA, WATERMARK, CHECKPOINT, TOMBSTONE, HEARTBEAT, RPC)
 * [14..15] Flags: uint16 bitfield (1=TOMBSTONE, 2=COMPRESSED, 4=SIDE_OUTPUT, 8=CONTROL)
 * [16..23] Offset / Sequence ID: uint64 (BigInt)
 * [24..31] Timestamp: int64 (Unix epoch milliseconds or nanoseconds)
 * [32..35] Key Length: uint32
 * [36..39] Metadata Length: uint32
 * [40..47] Correlation ID: uint64 (RPC matching token)
 * [48..63] Reserved: 16 bytes zero-filled (pads header to exactly 64 bytes)
 * [64..]   Payload: Key (bytes) + Metadata (bytes) + Value (bytes)
 */

import { crc32c, crc32cUpdate } from "./crc32c.js";

export const FRAME_MAGIC = 0x5A455048; // "ZEPH" in ASCII Little-Endian
export const HEADER_SIZE = 64;         // Exactly one cache line (64 bytes)

export const RecordType = Object.freeze({
  DATA: 0x0001,
  WATERMARK: 0x0002,
  CHECKPOINT: 0x0003,
  TOMBSTONE: 0x0004,
  HEARTBEAT: 0x0005,
  RPC_REQUEST: 0x0006,
  RPC_RESPONSE: 0x0007,
  SCHEMA_MIGRATION: 0x0008,
});

export const FrameFlags = Object.freeze({
  NONE: 0x0000,
  TOMBSTONE: 0x0001,
  COMPRESSED_LZ4: 0x0002,
  SIDE_OUTPUT: 0x0004,
  CONTROL_BARRIER: 0x0008,
});

/**
 * Encodes a record into a 64-byte aligned binary wire frame.
 *
 * @param {object} record
 * @param {number} [record.type=RecordType.DATA]
 * @param {number} [record.flags=FrameFlags.NONE]
 * @param {bigint|number} [record.offset=0n]
 * @param {bigint|number} [record.timestamp=Date.now()]
 * @param {bigint|number} [record.correlationId=0n]
 * @param {Buffer|Uint8Array|string|null} [record.key=null]
 * @param {Buffer|Uint8Array|object|string|null} [record.metadata=null]
 * @param {Buffer|Uint8Array|object|string|null} [record.value=null]
 * @returns {Buffer} Encoded framed buffer with 64-byte header and aligned payload
 */
export function encodeFrame(record) {
  const type = record.type ?? RecordType.DATA;
  const flags = record.flags ?? FrameFlags.NONE;
  const offset = BigInt(record.offset ?? 0);
  const timestamp = BigInt(record.timestamp ?? Date.now());
  const correlationId = BigInt(record.correlationId ?? 0);

  // Normalize key bytes
  let keyBuf = Buffer.alloc(0);
  if (record.key != null) {
    keyBuf = Buffer.isBuffer(record.key)
      ? record.key
      : Buffer.from(typeof record.key === "string" ? record.key : JSON.stringify(record.key));
  }

  // Normalize metadata bytes
  let metaBuf = Buffer.alloc(0);
  if (record.metadata != null) {
    metaBuf = Buffer.isBuffer(record.metadata)
      ? record.metadata
      : Buffer.from(typeof record.metadata === "string" ? record.metadata : JSON.stringify(record.metadata));
  }

  // Normalize value bytes
  let valBuf = Buffer.alloc(0);
  if (record.value != null) {
    valBuf = Buffer.isBuffer(record.value)
      ? record.value
      : Buffer.from(typeof record.value === "string" ? record.value : JSON.stringify(record.value));
  }

  const payloadLen = keyBuf.length + metaBuf.length + valBuf.length;
  // Pad total length to 8-byte alignment for hardware word operations
  const unalignedTotal = HEADER_SIZE + payloadLen;
  const paddingBytes = (8 - (unalignedTotal % 8)) % 8;
  const totalFrameSize = unalignedTotal + paddingBytes;

  const frame = Buffer.alloc(totalFrameSize);

  // Write header
  frame.writeUInt32LE(FRAME_MAGIC, 0);
  frame.writeUInt32LE(payloadLen, 4);
  // Placeholder for CRC32C at [8..11]
  frame.writeUInt16LE(type, 12);
  frame.writeUInt16LE(flags, 14);
  frame.writeBigUInt64LE(offset, 16);
  frame.writeBigInt64LE(timestamp, 24);
  frame.writeUInt32LE(keyBuf.length, 32);
  frame.writeUInt32LE(metaBuf.length, 36);
  frame.writeBigUInt64LE(correlationId, 40);
  // Bytes 48..63 are reserved zeros

  // Write payload slices
  let writeCursor = HEADER_SIZE;
  if (keyBuf.length > 0) {
    keyBuf.copy(frame, writeCursor);
    writeCursor += keyBuf.length;
  }
  if (metaBuf.length > 0) {
    metaBuf.copy(frame, writeCursor);
    writeCursor += metaBuf.length;
  }
  if (valBuf.length > 0) {
    valBuf.copy(frame, writeCursor);
    writeCursor += valBuf.length;
  }

  // Calculate CRC32C over header[12..63] and entire payload
  const headerCrc = crc32c(frame, 12, 52);
  const totalCrc = payloadLen > 0
    ? crc32cUpdate(headerCrc, frame, HEADER_SIZE, payloadLen)
    : headerCrc;

  frame.writeUInt32LE(totalCrc, 8);

  return frame;
}

/**
 * Decodes a binary wire frame from a buffer.
 *
 * @param {Buffer|Uint8Array} buffer Input buffer containing at least 64 bytes
 * @param {number} [startOffset=0] Byte offset to start reading
 * @returns {object} Decoded record object with parsed components and total byte length
 */
export function decodeFrame(buffer, startOffset = 0) {
  const available = buffer.length - startOffset;
  if (available < HEADER_SIZE) {
    throw new Error(`Incomplete frame header: available ${available} bytes, required ${HEADER_SIZE}`);
  }

  const magic = buffer.readUInt32LE(startOffset);
  if (magic !== FRAME_MAGIC) {
    throw new Error(`Invalid frame magic: expected 0x${FRAME_MAGIC.toString(16)}, received 0x${magic.toString(16)}`);
  }

  const payloadLen = buffer.readUInt32LE(startOffset + 4);
  const expectedCrc = buffer.readUInt32LE(startOffset + 8);
  const type = buffer.readUInt16LE(startOffset + 12);
  const flags = buffer.readUInt16LE(startOffset + 14);
  const offset = buffer.readBigUInt64LE(startOffset + 16);
  const timestamp = buffer.readBigInt64LE(startOffset + 24);
  const keyLen = buffer.readUInt32LE(startOffset + 32);
  const metaLen = buffer.readUInt32LE(startOffset + 36);
  const correlationId = buffer.readBigUInt64LE(startOffset + 40);

  const unalignedTotal = HEADER_SIZE + payloadLen;
  const paddingBytes = (8 - (unalignedTotal % 8)) % 8;
  const totalFrameSize = unalignedTotal + paddingBytes;

  if (available < totalFrameSize) {
    throw new Error(`Incomplete frame payload: available ${available} bytes, required ${totalFrameSize}`);
  }

  // Verify CRC32C
  const headerCrc = crc32c(buffer, startOffset + 12, 52);
  const actualCrc = payloadLen > 0
    ? crc32cUpdate(headerCrc, buffer, startOffset + HEADER_SIZE, payloadLen)
    : headerCrc;

  if (actualCrc !== expectedCrc) {
    throw new Error(`CRC32C checksum mismatch: frame expected 0x${expectedCrc.toString(16)}, computed 0x${actualCrc.toString(16)}`);
  }

  // Extract slices
  const payloadStart = startOffset + HEADER_SIZE;
  const key = buffer.subarray(payloadStart, payloadStart + keyLen);
  const metadata = buffer.subarray(payloadStart + keyLen, payloadStart + keyLen + metaLen);
  const value = buffer.subarray(payloadStart + keyLen + metaLen, payloadStart + payloadLen);

  return {
    type,
    flags,
    offset,
    timestamp,
    correlationId,
    key,
    metadata,
    value,
    totalBytes: totalFrameSize,
  };
}
