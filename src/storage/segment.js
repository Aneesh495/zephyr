/**
 * src/storage/segment.js
 *
 * Append-only log segment representing a physical chunk of a topic partition log.
 * Enforces 64-byte aligned binary wire framing, Castagnoli CRC32C verification,
 * and automatic truncation of partial or torn writes upon crash recovery.
 */

import fs from "node:fs";
import path from "node:path";
import { encodeFrame, decodeFrame, HEADER_SIZE, FRAME_MAGIC } from "../common/binary_frame.js";

export class LogSegment {
  /**
   * @param {object} options
   * @param {string} options.directory Directory path where the segment is stored
   * @param {bigint} options.baseOffset Starting logical offset of this segment
   * @param {number} [options.maxSizeBytes=67108864] Maximum segment size before rolling (default 64MB)
   */
  constructor({ directory, baseOffset, maxSizeBytes = 64 * 1024 * 1024 }) {
    this.directory = directory;
    this.baseOffset = BigInt(baseOffset);
    this.maxSizeBytes = maxSizeBytes;

    const baseStr = this.baseOffset.toString().padStart(20, "0");
    this.segmentPath = path.join(this.directory, `${baseStr}.seg`);
    this.fd = null;
    this.size = 0;
    this.nextOffset = this.baseOffset;
    this.lastTimestamp = 0n;
    this.recordCount = 0;
    this.isClosed = false;
  }

  /**
   * Opens the segment file and performs crash recovery on existing files.
   */
  open() {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    if (fs.existsSync(this.segmentPath)) {
      this.fd = fs.openSync(this.segmentPath, "r+");
      this._recoverAndReindex();
    } else {
      this.fd = fs.openSync(this.segmentPath, "w+");
      this.size = 0;
      this.nextOffset = this.baseOffset;
    }
  }

  /**
   * Scans existing file to determine exact valid size and next logical offset.
   * If a torn or corrupt trailing write is encountered, the file is safely truncated.
   */
  _recoverAndReindex() {
    const stat = fs.fstatSync(this.fd);
    let validPosition = 0;
    let cursor = 0;
    const fileLen = stat.size;
    const headerBuf = Buffer.alloc(HEADER_SIZE);

    while (cursor + HEADER_SIZE <= fileLen) {
      fs.readSync(this.fd, headerBuf, 0, HEADER_SIZE, cursor);

      const magic = headerBuf.readUInt32LE(0);
      if (magic !== FRAME_MAGIC) {
        break; // Corrupt or unaligned frame encountered, stop recovery scan
      }

      const payloadLen = headerBuf.readUInt32LE(4);
      const unalignedTotal = HEADER_SIZE + payloadLen;
      const paddingBytes = (8 - (unalignedTotal % 8)) % 8;
      const totalFrameSize = unalignedTotal + paddingBytes;

      if (cursor + totalFrameSize > fileLen) {
        break; // Partial or torn write at end of segment
      }

      // Read entire frame to verify CRC32C
      const fullFrame = Buffer.alloc(totalFrameSize);
      fs.readSync(this.fd, fullFrame, 0, totalFrameSize, cursor);

      try {
        const decoded = decodeFrame(fullFrame);
        this.nextOffset = decoded.offset + 1n;
        this.lastTimestamp = decoded.timestamp;
        this.recordCount++;
        cursor += totalFrameSize;
        validPosition = cursor;
      } catch {
        // CRC32C validation failure: stop scan and truncate here
        break;
      }
    }

    if (validPosition < fileLen) {
      fs.ftruncateSync(this.fd, validPosition);
    }

    this.size = validPosition;
  }

  /**
   * Appends a record to the segment.
   *
   * @param {object} record Record to encode and append
   * @param {boolean} [sync=false] Whether to fsync immediately
   * @returns {{ offset: bigint, position: number, bytesWritten: number, timestamp: bigint }}
   */
  append(record, sync = false) {
    if (this.isClosed) {
      throw new Error(`Cannot append to closed segment ${this.segmentPath}`);
    }

    const assignedOffset = record.offset !== undefined ? BigInt(record.offset) : this.nextOffset;
    const assignedTimestamp = record.timestamp !== undefined ? BigInt(record.timestamp) : BigInt(Date.now());

    const recordToEncode = {
      ...record,
      offset: assignedOffset,
      timestamp: assignedTimestamp,
    };

    const encoded = encodeFrame(recordToEncode);
    const writePos = this.size;

    fs.writeSync(this.fd, encoded, 0, encoded.length, writePos);

    if (sync) {
      fs.fsyncSync(this.fd);
    }

    this.size += encoded.length;
    this.nextOffset = assignedOffset + 1n;
    this.lastTimestamp = assignedTimestamp;
    this.recordCount++;

    return {
      offset: assignedOffset,
      position: writePos,
      bytesWritten: encoded.length,
      timestamp: assignedTimestamp,
    };
  }

  /**
   * Reads a raw decoded frame from a specific physical file position.
   *
   * @param {number} position Byte position in the segment file
   * @returns {object} Decoded frame record
   */
  readAt(position) {
    if (position >= this.size) {
      return null;
    }

    const headerBuf = Buffer.alloc(HEADER_SIZE);
    fs.readSync(this.fd, headerBuf, 0, HEADER_SIZE, position);

    const payloadLen = headerBuf.readUInt32LE(4);
    const unalignedTotal = HEADER_SIZE + payloadLen;
    const paddingBytes = (8 - (unalignedTotal % 8)) % 8;
    const totalFrameSize = unalignedTotal + paddingBytes;

    const fullFrame = Buffer.alloc(totalFrameSize);
    fs.readSync(this.fd, fullFrame, 0, totalFrameSize, position);

    return decodeFrame(fullFrame);
  }

  /**
   * Checks if segment has exceeded configured maximum size limit.
   *
   * @returns {boolean}
   */
  isFull() {
    return this.size >= this.maxSizeBytes;
  }

  sync() {
    if (this.fd) {
      fs.fsyncSync(this.fd);
    }
  }

  close() {
    if (!this.isClosed && this.fd) {
      fs.fsyncSync(this.fd);
      fs.closeSync(this.fd);
      this.fd = null;
      this.isClosed = true;
    }
  }

  destroy() {
    this.close();
    if (fs.existsSync(this.segmentPath)) {
      fs.unlinkSync(this.segmentPath);
    }
  }
}
