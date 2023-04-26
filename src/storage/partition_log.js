/**
 * src/storage/partition_log.js
 *
 * Topic partition log orchestrating active and sealed immutable segments.
 * Provides continuous monotonic offsets, automated segment rolling,
 * sub-millisecond sparse-indexed reads, and time/size-based retention cleanup.
 */

import fs from "node:fs";
import path from "node:path";
import { LogSegment } from "./segment.js";
import { SparseIndex } from "./sparse_index.js";

export class PartitionLog {
  /**
   * @param {object} options
   * @param {string} options.directory Storage directory for partition
   * @param {string} options.topic Topic name
   * @param {number} options.partition Partition index
   * @param {number} [options.maxSegmentBytes=67108864] Maximum size per segment before rolling (64MB)
   * @param {number} [options.indexIntervalBytes=4096] Sparse index stride
   * @param {number} [options.retentionMs=604800000] Retention time in ms (default 7 days)
   * @param {number} [options.retentionBytes=10737418240] Retention size in bytes (default 10GB)
   */
  constructor({
    directory,
    topic,
    partition,
    maxSegmentBytes = 64 * 1024 * 1024,
    indexIntervalBytes = 4096,
    retentionMs = 7 * 24 * 3600 * 1000,
    retentionBytes = 10 * 1024 * 1024 * 1024,
  }) {
    this.directory = directory;
    this.topic = topic;
    this.partition = partition;
    this.maxSegmentBytes = maxSegmentBytes;
    this.indexIntervalBytes = indexIntervalBytes;
    this.retentionMs = retentionMs;
    this.retentionBytes = retentionBytes;

    /** @type {Array<{ segment: LogSegment, index: SparseIndex }>} */
    this.segments = [];
    this.active = null;
    this.isClosed = false;
  }

  open() {
    if (!fs.existsSync(this.directory)) {
      fs.mkdirSync(this.directory, { recursive: true });
    }

    // Discover existing segments
    const files = fs.readdirSync(this.directory);
    const segFiles = files.filter((f) => f.endsWith(".seg")).sort();

    if (segFiles.length === 0) {
      // Initialize brand new partition with base offset 0
      this._roll(0n);
    } else {
      // Load all segments in ascending order
      for (const f of segFiles) {
        const baseOffset = BigInt(f.replace(".seg", ""));
        const segment = new LogSegment({
          directory: this.directory,
          baseOffset,
          maxSizeBytes: this.maxSegmentBytes,
        });
        segment.open();

        const index = new SparseIndex({
          directory: this.directory,
          baseOffset,
          intervalBytes: this.indexIntervalBytes,
        });
        index.open();
        index.truncateToPosition(segment.size);

        this.segments.push({ segment, index });
      }

      this.active = this.segments[this.segments.length - 1];
    }
  }

  /**
   * Rolls a new active segment starting at specified base offset.
   *
   * @param {bigint} baseOffset
   */
  _roll(baseOffset) {
    if (this.active) {
      this.active.segment.sync();
      this.active.index.sync();
    }

    const segment = new LogSegment({
      directory: this.directory,
      baseOffset,
      maxSizeBytes: this.maxSegmentBytes,
    });
    segment.open();

    const index = new SparseIndex({
      directory: this.directory,
      baseOffset,
      intervalBytes: this.indexIntervalBytes,
    });
    index.open();

    const pair = { segment, index };
    this.segments.push(pair);
    this.active = pair;
  }

  /**
   * Appends a record to the partition log. Automatically rolls active segment if full.
   *
   * @param {object} record Record to append
   * @param {boolean} [sync=false] Whether to fsync to disk
   * @returns {{ offset: bigint, timestamp: bigint }}
   */
  append(record, sync = false) {
    if (this.isClosed) {
      throw new Error(`Cannot append to closed partition log in ${this.directory}`);
    }

    if (this.active.segment.isFull()) {
      this._roll(this.active.segment.nextOffset);
    }

    const { segment, index } = this.active;
    const appendResult = segment.append(record, sync);

    index.maybeAppend(appendResult.offset, appendResult.position, index.entriesCount === 0);

    return {
      offset: appendResult.offset,
      timestamp: appendResult.timestamp,
    };
  }

  /**
   * Finds the segment containing the requested offset via binary search.
   *
   * @param {bigint} targetOffset
   * @returns {{ segment: LogSegment, index: SparseIndex }|null}
   */
  _findSegmentForOffset(targetOffset) {
    if (this.segments.length === 0) return null;
    const target = BigInt(targetOffset);

    let low = 0;
    let high = this.segments.length - 1;
    let best = null;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const pair = this.segments[mid];

      if (pair.segment.baseOffset <= target) {
        best = pair;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  }

  /**
   * Reads a batch of records starting from targetOffset up to maxRecords.
   *
   * @param {bigint|number} startOffset Target logical offset to begin reading
   * @param {number} [maxRecords=100] Maximum records to return
   * @returns {Array<object>} Batch of decoded records
   */
  read(startOffset, maxRecords = 100) {
    const target = BigInt(startOffset);
    let pair = this._findSegmentForOffset(target);
    if (!pair) {
      return [];
    }

    const results = [];
    let segIdx = this.segments.indexOf(pair);

    while (segIdx < this.segments.length && results.length < maxRecords) {
      const current = this.segments[segIdx];
      const startPos = current.index.lookup(target);
      let pos = startPos;

      while (pos < current.segment.size && results.length < maxRecords) {
        const record = current.segment.readAt(pos);
        if (!record) break;

        pos += record.totalBytes;
        if (record.offset >= target) {
          results.push(record);
        }
      }

      segIdx++;
    }

    return results;
  }

  /**
   * Returns earliest and latest available offsets in this partition.
   *
   * @returns {{ earliestOffset: bigint, highWatermark: bigint }}
   */
  getOffsetBounds() {
    if (this.segments.length === 0) {
      return { earliestOffset: 0n, highWatermark: 0n };
    }
    const earliestOffset = this.segments[0].segment.baseOffset;
    const highWatermark = this.active.segment.nextOffset;
    return { earliestOffset, highWatermark };
  }

  /**
   * Purges segments that exceed retention period or total partition size limit.
   *
   * @returns {number} Count of segments pruned
   */
  enforceRetention() {
    const now = Date.now();
    let pruned = 0;

    // Retain at least the active segment
    while (this.segments.length > 1) {
      const oldest = this.segments[0];
      const ageMs = now - Number(oldest.segment.lastTimestamp);
      const isExpired = oldest.segment.lastTimestamp > 0n && ageMs > this.retentionMs;

      // Check total size
      let totalBytes = 0;
      for (const p of this.segments) totalBytes += p.segment.size;
      const isOverSize = totalBytes > this.retentionBytes;

      if (isExpired || isOverSize) {
        oldest.segment.destroy();
        oldest.index.destroy();
        this.segments.shift();
        pruned++;
      } else {
        break;
      }
    }

    return pruned;
  }

  sync() {
    if (this.active) {
      this.active.segment.sync();
      this.active.index.sync();
    }
  }

  close() {
    if (!this.isClosed) {
      for (const pair of this.segments) {
        pair.segment.close();
        pair.index.close();
      }
      this.isClosed = true;
    }
  }
}
