/**
 * src/concurrency/shared_memory.js
 *
 * Contiguous SharedArrayBuffer memory layout coordinator for zero-serialization
 * inter-worker streaming pipelines.
 *
 * Memory Region Topography:
 * [000..063] Global Control Block (64 bytes):
 *            - 0..7:   Global Event Sequence Counter (int64)
 *            - 8..15:  Worker Heartbeat & Status Mask (int64)
 *            - 16..23: Ring Head Sequence (int64)
 *            - 24..31: Ring Tail Sequence (int64)
 *            - 32..63: Cache line padding
 * [064..511] Slot Sequence Table (64 slots x 8 bytes = 512 bytes)
 * [512..END] Data Slabs: 64 slots of 64KB each (Total ~4MB)
 */

export const DEFAULT_SLOT_COUNT = 64;
export const DEFAULT_SLOT_SIZE = 64 * 1024; // 64KB per slot
export const CONTROL_BLOCK_SIZE = 64;

export class SharedMemoryCoordinator {
  /**
   * @param {object} [options]
   * @param {number} [options.slotCount=64] Number of streaming slots (must be power of two)
   * @param {number} [options.slotSizeBytes=65536] Size per streaming slot in bytes
   * @param {SharedArrayBuffer} [options.existingBuffer] Attach to existing buffer (worker threads)
   */
  constructor({
    slotCount = DEFAULT_SLOT_COUNT,
    slotSizeBytes = DEFAULT_SLOT_SIZE,
    existingBuffer = null,
  } = {}) {
    if ((slotCount & (slotCount - 1)) !== 0) {
      throw new Error(`Slot count must be a power of two, got ${slotCount}`);
    }

    this.slotCount = slotCount;
    this.slotMask = slotCount - 1;
    this.slotSizeBytes = slotSizeBytes;

    const seqTableSize = slotCount * 8;
    this.headerOffset = 0;
    this.seqTableOffset = CONTROL_BLOCK_SIZE;
    this.dataSlabsOffset = CONTROL_BLOCK_SIZE + seqTableSize;

    const totalBytes = this.dataSlabsOffset + (slotCount * slotSizeBytes);

    if (existingBuffer) {
      this.sharedBuffer = existingBuffer;
    } else {
      this.sharedBuffer = new SharedArrayBuffer(totalBytes);
      // Initialize sequence table with default slot indices
      const seqView = new BigInt64Array(this.sharedBuffer, this.seqTableOffset, this.slotCount);
      for (let i = 0; i < this.slotCount; i++) {
        seqView[i] = BigInt(i);
      }
    }

    this.control = new BigInt64Array(this.sharedBuffer, this.headerOffset, 8);
    this.slotSequences = new BigInt64Array(this.sharedBuffer, this.seqTableOffset, this.slotCount);
  }

  /**
   * Allocates/claims a slot for writing a binary framed batch.
   *
   * @returns {{ slotIndex: number, byteOffset: number, maxBytes: number, sequence: bigint }|null}
   */
  claimSlotForWrite() {
    while (true) {
      const tail = Atomics.load(this.control, 3); // Ring tail is index 3
      const slot = Number(tail) & this.slotMask;
      const seq = Atomics.load(this.slotSequences, slot);
      const diff = seq - tail;

      if (diff === 0n) {
        if (Atomics.compareExchange(this.control, 3, tail, tail + 1n) === tail) {
          const byteOffset = this.dataSlabsOffset + (slot * this.slotSizeBytes);
          return {
            slotIndex: slot,
            byteOffset,
            maxBytes: this.slotSizeBytes,
            sequence: tail,
          };
        }
      } else if (diff < 0n) {
        return null; // Ring buffer full, backpressure triggered
      }
    }
  }

  /**
   * Commits written slot and advances slot sequence so consumers can read it.
   *
   * @param {number} slotIndex
   * @param {bigint} sequence
   */
  commitSlotWrite(slotIndex, sequence) {
    Atomics.store(this.slotSequences, slotIndex, sequence + 1n);
  }

  /**
   * Claims a slot for reading.
   *
   * @returns {{ slotIndex: number, byteOffset: number, maxBytes: number, sequence: bigint }|null}
   */
  claimSlotForRead() {
    while (true) {
      const head = Atomics.load(this.control, 2); // Ring head is index 2
      const slot = Number(head) & this.slotMask;
      const seq = Atomics.load(this.slotSequences, slot);
      const diff = seq - (head + 1n);

      if (diff === 0n) {
        if (Atomics.compareExchange(this.control, 2, head, head + 1n) === head) {
          const byteOffset = this.dataSlabsOffset + (slot * this.slotSizeBytes);
          return {
            slotIndex: slot,
            byteOffset,
            maxBytes: this.slotSizeBytes,
            sequence: head,
          };
        }
      } else if (diff < 0n) {
        return null; // No readable slots available
      }
    }
  }

  /**
   * Releases a read slot so producers can reuse it.
   *
   * @param {number} slotIndex
   * @param {bigint} sequence
   */
  releaseSlotRead(slotIndex, sequence) {
    Atomics.store(this.slotSequences, slotIndex, sequence + BigInt(this.slotCount));
  }
}
