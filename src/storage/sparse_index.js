/**
 * src/storage/sparse_index.js
 *
 * Sparse index providing O(log N) offset-to-physical-position and timestamp-to-offset lookups.
 * Stores fixed 12-byte entries on disk:
 * [0..3]  Relative Offset (uint32, relative to baseOffset)
 * [4..11] Physical File Position (uint64, byte offset in .seg file)
 */

import fs from "node:fs";
import path from "node:path";

export const ENTRY_SIZE = 12; // 4 bytes relative offset + 8 bytes file position

export class SparseIndex {
  /**
   * @param {object} options
   * @param {string} options.directory Directory path
   * @param {bigint} options.baseOffset Base offset for this segment
   * @param {number} [options.intervalBytes=4096] Index entry frequency (default: every 4KB)
   */
  constructor({ directory, baseOffset, intervalBytes = 4096 }) {
    this.directory = directory;
    this.baseOffset = BigInt(baseOffset);
    this.intervalBytes = intervalBytes;

    const baseStr = this.baseOffset.toString().padStart(20, "0");
    this.indexPath = path.join(this.directory, `${baseStr}.idx`);
    this.fd = null;
    this.entriesCount = 0;
    this.lastPositionIndexed = -1;

    // In-memory typed arrays for sub-microsecond binary search
    this.offsets = [];
    this.positions = [];
    this.isClosed = false;
  }

  open() {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    if (fs.existsSync(this.indexPath)) {
      this.fd = fs.openSync(this.indexPath, "r+");
      this._loadEntries();
    } else {
      this.fd = fs.openSync(this.indexPath, "w+");
      this.entriesCount = 0;
    }
  }

  _loadEntries() {
    const stat = fs.fstatSync(this.fd);
    const validBytes = Math.floor(stat.size / ENTRY_SIZE) * ENTRY_SIZE;
    if (validBytes < stat.size) {
      fs.ftruncateSync(this.fd, validBytes);
    }

    const count = validBytes / ENTRY_SIZE;
    const buf = Buffer.alloc(validBytes);
    fs.readSync(this.fd, buf, 0, validBytes, 0);

    this.offsets = new Array(count);
    this.positions = new Array(count);

    for (let i = 0; i < count; i++) {
      const idx = i * ENTRY_SIZE;
      const relOffset = buf.readUInt32LE(idx);
      const position = Number(buf.readBigUInt64LE(idx + 4));
      this.offsets[i] = this.baseOffset + BigInt(relOffset);
      this.positions[i] = position;
    }

    this.entriesCount = count;
    if (count > 0) {
      this.lastPositionIndexed = this.positions[count - 1];
    }
  }

  /**
   * Conditionally appends an index entry if position has advanced past intervalBytes.
   *
   * @param {bigint} offset Absolute record offset
   * @param {number} position Physical byte position in segment
   * @param {boolean} [force=false] Force append regardless of interval
   */
  maybeAppend(offset, position, force = false) {
    if (this.isClosed) {
      throw new Error(`Cannot append to closed index ${this.indexPath}`);
    }

    if (!force && this.lastPositionIndexed >= 0 && (position - this.lastPositionIndexed) < this.intervalBytes) {
      return false; // Skip sparse interval
    }

    const relOffset = Number(BigInt(offset) - this.baseOffset);
    if (relOffset < 0 || relOffset > 0xFFFFFFFF) {
      throw new Error(`Relative offset ${relOffset} out of 32-bit range for base ${this.baseOffset}`);
    }

    const entryBuf = Buffer.alloc(ENTRY_SIZE);
    entryBuf.writeUInt32LE(relOffset, 0);
    entryBuf.writeBigUInt64LE(BigInt(position), 4);

    fs.writeSync(this.fd, entryBuf, 0, ENTRY_SIZE, this.entriesCount * ENTRY_SIZE);

    this.offsets.push(BigInt(offset));
    this.positions.push(position);
    this.entriesCount++;
    this.lastPositionIndexed = position;

    return true;
  }

  /**
   * Performs an exact binary search to find the largest indexed offset <= targetOffset.
   * Returns the corresponding physical segment file position.
   *
   * @param {bigint} targetOffset Target offset to lookup
   * @returns {number} Physical position in segment file (or 0 if before first entry)
   */
  lookup(targetOffset) {
    const target = BigInt(targetOffset);
    if (this.entriesCount === 0 || target < this.baseOffset) {
      return 0;
    }

    let low = 0;
    let high = this.entriesCount - 1;
    let bestMatch = 0;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const midOffset = this.offsets[mid];

      if (midOffset === target) {
        return this.positions[mid];
      } else if (midOffset < target) {
        bestMatch = this.positions[mid];
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return bestMatch;
  }

  /**
   * Truncates the index to match a given segment size.
   *
   * @param {number} maxValidPosition Physical position limit from segment recovery
   */
  truncateToPosition(maxValidPosition) {
    let validCount = 0;
    for (let i = 0; i < this.entriesCount; i++) {
      if (this.positions[i] <= maxValidPosition) {
        validCount++;
      } else {
        break;
      }
    }

    if (validCount < this.entriesCount) {
      this.entriesCount = validCount;
      this.offsets.length = validCount;
      this.positions.length = validCount;
      fs.ftruncateSync(this.fd, validCount * ENTRY_SIZE);
      this.lastPositionIndexed = validCount > 0 ? this.positions[validCount - 1] : -1;
    }
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
    if (fs.existsSync(this.indexPath)) {
      fs.unlinkSync(this.indexPath);
    }
  }
}
