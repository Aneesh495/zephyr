/**
 * src/concurrency/ring_buffer.js
 *
 * High-throughput, lock-free ring buffers implementing the LMAX Disruptor pattern
 * over JavaScript SharedArrayBuffer and TypedArrays with Atomics memory barriers.
 *
 * Includes:
 * 1. SingleProducerSingleConsumerRingBuffer (SPSC): Zero-lock, cache-padded indices.
 * 2. MultiProducerMultiConsumerRingBuffer (MPMC): Dmitry Vyukov lock-free queue algorithm
 *    with per-cell sequence tracking and Atomics.compareExchange.
 */

// Cache line size in bytes (64 bytes = 8 x 64-bit BigInts)
const CACHE_LINE_INTS = 8;

export class SPSCQueue {
  /**
   * @param {number} [capacity=1024] Must be a power of two
   * @param {SharedArrayBuffer} [sharedBuffer] Optional shared memory backing
   */
  constructor(capacity = 1024, sharedBuffer = null) {
    if ((capacity & (capacity - 1)) !== 0 || capacity <= 0) {
      throw new Error(`Ring buffer capacity must be a power of two, got ${capacity}`);
    }

    this.capacity = capacity;
    this.mask = capacity - 1;

    // Use SharedArrayBuffer if provided, else normal ArrayBuffer
    // Padding layout:
    // [0..7]: Head sequence and cache line pad
    // [8..15]: Tail sequence and cache line pad
    const controlBuffer = sharedBuffer
      ? sharedBuffer
      : (typeof SharedArrayBuffer !== "undefined"
          ? new SharedArrayBuffer(16 * 8)
          : new ArrayBuffer(16 * 8));

    this.sequences = new BigInt64Array(controlBuffer, 0, 16);
    this.headIndex = 0; // Pad offset 0
    this.tailIndex = CACHE_LINE_INTS; // Pad offset 8 (different cache line)

    // Items array (in-memory object references or serialized tokens)
    this.items = new Array(capacity);
  }

  /**
   * Enqueues an item without acquiring any locks.
   *
   * @param {*} item
   * @returns {boolean} True if successfully enqueued, false if ring buffer is full
   */
  offer(item) {
    const tail = Atomics.load(this.sequences, this.tailIndex);
    const head = Atomics.load(this.sequences, this.headIndex);

    if (Number(tail - head) >= this.capacity) {
      return false; // Queue full
    }

    const slot = Number(tail) & this.mask;
    this.items[slot] = item;

    // Store release barrier
    Atomics.store(this.sequences, this.tailIndex, tail + 1n);
    return true;
  }

  /**
   * Dequeues an item without acquiring any locks.
   *
   * @returns {*|undefined} Next item or undefined if queue is empty
   */
  poll() {
    const head = Atomics.load(this.sequences, this.headIndex);
    const tail = Atomics.load(this.sequences, this.tailIndex);

    if (head >= tail) {
      return undefined; // Queue empty
    }

    const slot = Number(head) & this.mask;
    const item = this.items[slot];
    this.items[slot] = null; // Prevent memory leak

    // Store release barrier
    Atomics.store(this.sequences, this.headIndex, head + 1n);
    return item;
  }

  size() {
    const head = Atomics.load(this.sequences, this.headIndex);
    const tail = Atomics.load(this.sequences, this.tailIndex);
    return Math.max(0, Number(tail - head));
  }

  isEmpty() {
    return this.size() === 0;
  }

  isFull() {
    return this.size() >= this.capacity;
  }
}

export class MPMCQueue {
  /**
   * Dmitry Vyukov bounded lock-free MPMC queue.
   *
   * @param {number} [capacity=1024] Must be a power of two
   */
  constructor(capacity = 1024) {
    if ((capacity & (capacity - 1)) !== 0 || capacity <= 0) {
      throw new Error(`MPMC capacity must be a power of two, got ${capacity}`);
    }

    this.capacity = capacity;
    this.mask = capacity - 1;

    // Sequence array initialized with cell indices
    const seqBuffer = typeof SharedArrayBuffer !== "undefined"
      ? new SharedArrayBuffer(capacity * 8)
      : new ArrayBuffer(capacity * 8);
    this.cellSequences = new BigInt64Array(seqBuffer);

    for (let i = 0; i < capacity; i++) {
      this.cellSequences[i] = BigInt(i);
    }

    const controlBuffer = typeof SharedArrayBuffer !== "undefined"
      ? new SharedArrayBuffer(16 * 8)
      : new ArrayBuffer(16 * 8);
    this.control = new BigInt64Array(controlBuffer);
    this.headIdx = 0;
    this.tailIdx = CACHE_LINE_INTS;

    this.items = new Array(capacity);
  }

  /**
   * Enqueues an item using atomic compare-and-swap on cell sequence.
   *
   * @param {*} item
   * @returns {boolean} True if enqueued, false if full
   */
  offer(item) {
    while (true) {
      const tail = Atomics.load(this.control, this.tailIdx);
      const slot = Number(tail) & this.mask;
      const seq = Atomics.load(this.cellSequences, slot);
      const diff = seq - tail;

      if (diff === 0n) {
        if (Atomics.compareExchange(this.control, this.tailIdx, tail, tail + 1n) === tail) {
          this.items[slot] = item;
          Atomics.store(this.cellSequences, slot, tail + 1n);
          return true;
        }
      } else if (diff < 0n) {
        return false; // Queue full
      }
      // Contention occurred, loop and retry
    }
  }

  /**
   * Dequeues an item using atomic compare-and-swap on cell sequence.
   *
   * @returns {*|undefined} Item or undefined if empty
   */
  poll() {
    while (true) {
      const head = Atomics.load(this.control, this.headIdx);
      const slot = Number(head) & this.mask;
      const seq = Atomics.load(this.cellSequences, slot);
      const diff = seq - (head + 1n);

      if (diff === 0n) {
        if (Atomics.compareExchange(this.control, this.headIdx, head, head + 1n) === head) {
          const item = this.items[slot];
          this.items[slot] = null;
          Atomics.store(this.cellSequences, slot, head + BigInt(this.capacity));
          return item;
        }
      } else if (diff < 0n) {
        return undefined; // Queue empty
      }
      // Contention occurred, loop and retry
    }
  }

  size() {
    const head = Atomics.load(this.control, this.headIdx);
    const tail = Atomics.load(this.control, this.tailIdx);
    return Math.max(0, Number(tail - head));
  }
}
