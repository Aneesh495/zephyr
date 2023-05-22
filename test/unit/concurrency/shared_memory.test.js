/**
 * test/unit/concurrency/shared_memory.test.js
 *
 * Verifies SharedMemoryCoordinator layout calculations, slot claiming,
 * commit semantics, and backpressure behavior.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SharedMemoryCoordinator } from "../../../src/concurrency/shared_memory.js";

describe("SharedMemoryCoordinator Slabs & Atomics", () => {
  it("claims and commits write slots sequentially", () => {
    const sm = new SharedMemoryCoordinator({ slotCount: 4, slotSizeBytes: 1024 });

    const w0 = sm.claimSlotForWrite();
    assert.ok(w0 !== null);
    assert.strictEqual(w0.slotIndex, 0);

    const w1 = sm.claimSlotForWrite();
    assert.ok(w1 !== null);
    assert.strictEqual(w1.slotIndex, 1);

    // Read before commit should return null
    assert.strictEqual(sm.claimSlotForRead(), null);

    // Commit w0
    sm.commitSlotWrite(w0.slotIndex, w0.sequence);

    // Now w0 can be claimed for read
    const r0 = sm.claimSlotForRead();
    assert.ok(r0 !== null);
    assert.strictEqual(r0.slotIndex, 0);
    assert.strictEqual(r0.sequence, w0.sequence);

    // Release r0
    sm.releaseSlotRead(r0.slotIndex, r0.sequence);
  });

  it("triggers backpressure when all slots are occupied", () => {
    const sm = new SharedMemoryCoordinator({ slotCount: 2, slotSizeBytes: 512 });

    const w0 = sm.claimSlotForWrite();
    const w1 = sm.claimSlotForWrite();
    assert.ok(w0 !== null);
    assert.ok(w1 !== null);

    // Third write claim must return null (ring full)
    const w2 = sm.claimSlotForWrite();
    assert.strictEqual(w2, null);
  });
});
