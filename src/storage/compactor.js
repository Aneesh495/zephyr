/**
 * src/storage/compactor.js
 *
 * Background log compaction and tombstone cleaner for changelog topics.
 * Deduplicates keyed records across sealed segments retaining only the latest
 * state per key, and safely purges expired tombstone markers.
 */

import fs from "node:fs";
import path from "node:path";
import { LogSegment } from "./segment.js";
import { SparseIndex } from "./sparse_index.js";
import { FrameFlags } from "../common/binary_frame.js";

export class LogCompactor {
  /**
   * @param {object} [options]
   * @param {number} [options.tombstoneRetentionMs=86400000] Retention for tombstones (default 24h)
   */
  constructor({ tombstoneRetentionMs = 24 * 3600 * 1000 } = {}) {
    this.tombstoneRetentionMs = tombstoneRetentionMs;
  }

  /**
   * Compacts eligible sealed segments of a PartitionLog in-place.
   *
   * @param {import('./partition_log.js').PartitionLog} partitionLog
   * @returns {{ bytesReclaimed: number, recordsPruned: number, segmentsCompacted: number }}
   */
  compact(partitionLog) {
    // Only compact if there is at least one sealed segment behind active
    if (partitionLog.segments.length <= 1) {
      return { bytesReclaimed: 0, recordsPruned: 0, segmentsCompacted: 0 };
    }

    // Identify sealed segments (all except active)
    const sealedPairs = partitionLog.segments.slice(0, partitionLog.segments.length - 1);
    if (sealedPairs.length === 0) {
      return { bytesReclaimed: 0, recordsPruned: 0, segmentsCompacted: 0 };
    }

    // Step 1: Build latest offset index per key
    /** @type {Map<string, { offset: bigint, timestamp: bigint, isTombstone: boolean }>} */
    const latestKeyMap = new Map();

    for (const pair of sealedPairs) {
      let pos = 0;
      while (pos < pair.segment.size) {
        const record = pair.segment.readAt(pos);
        if (!record) break;
        pos += record.totalBytes;

        const keyStr = record.key.toString("utf8");
        const isTombstone = (record.flags & FrameFlags.TOMBSTONE) !== 0 || record.value.length === 0;

        const existing = latestKeyMap.get(keyStr);
        if (!existing || record.offset > existing.offset) {
          latestKeyMap.set(keyStr, {
            offset: record.offset,
            timestamp: record.timestamp,
            isTombstone,
          });
        }
      }
    }

    // Step 2: Write deduplicated records into a temporary compacted segment
    const firstBaseOffset = sealedPairs[0].segment.baseOffset;
    const tempDir = path.join(partitionLog.directory, "compaction_tmp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempSegment = new LogSegment({
      directory: tempDir,
      baseOffset: firstBaseOffset,
      maxSizeBytes: partitionLog.maxSegmentBytes * 4,
    });
    tempSegment.open();

    const tempIndex = new SparseIndex({
      directory: tempDir,
      baseOffset: firstBaseOffset,
      intervalBytes: partitionLog.indexIntervalBytes,
    });
    tempIndex.open();

    let initialTotalBytes = 0;
    for (const p of sealedPairs) initialTotalBytes += p.segment.size;

    let recordsRetained = 0;
    let recordsPruned = 0;
    const now = Date.now();

    for (const pair of sealedPairs) {
      let pos = 0;
      while (pos < pair.segment.size) {
        const record = pair.segment.readAt(pos);
        if (!record) break;
        pos += record.totalBytes;

        const keyStr = record.key.toString("utf8");
        const latest = latestKeyMap.get(keyStr);

        // Retain only if this record matches the latest offset for this key
        if (latest && record.offset === latest.offset) {
          // If tombstone, check if expired
          const ageMs = now - Number(record.timestamp);
          if (latest.isTombstone && ageMs > this.tombstoneRetentionMs) {
            recordsPruned++;
            continue; // Expired tombstone dropped!
          }

          const app = tempSegment.append(record);
          tempIndex.maybeAppend(app.offset, app.position, tempIndex.entriesCount === 0);
          recordsRetained++;
        } else {
          recordsPruned++;
        }
      }
    }

    tempSegment.sync();
    tempIndex.sync();
    tempSegment.close();
    tempIndex.close();

    const finalBytes = tempSegment.size;
    const bytesReclaimed = Math.max(0, initialTotalBytes - finalBytes);

    // Step 3: Replace old sealed segments with the compacted segment
    // Close and destroy old sealed segments
    for (const p of sealedPairs) {
      p.segment.destroy();
      p.index.destroy();
    }

    // Move compacted files to partition directory
    const targetBaseStr = firstBaseOffset.toString().padStart(20, "0");
    const targetSegPath = path.join(partitionLog.directory, `${targetBaseStr}.seg`);
    const targetIdxPath = path.join(partitionLog.directory, `${targetBaseStr}.idx`);

    fs.renameSync(tempSegment.segmentPath, targetSegPath);
    fs.renameSync(tempIndex.indexPath, targetIdxPath);
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Reopen compacted segment and update partitionLog.segments array
    const compactedSeg = new LogSegment({
      directory: partitionLog.directory,
      baseOffset: firstBaseOffset,
      maxSizeBytes: partitionLog.maxSegmentBytes,
    });
    compactedSeg.open();

    const compactedIdx = new SparseIndex({
      directory: partitionLog.directory,
      baseOffset: firstBaseOffset,
      intervalBytes: partitionLog.indexIntervalBytes,
    });
    compactedIdx.open();

    partitionLog.segments = [{ segment: compactedSeg, index: compactedIdx }, partitionLog.active];

    return {
      bytesReclaimed,
      recordsPruned,
      segmentsCompacted: sealedPairs.length,
    };
  }
}
