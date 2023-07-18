/**
 * test/unit/stream/changelog.test.js
 *
 * Verifies MaterializedTable state materialization, INSERT/UPDATE/DELETE
 * changelog mutations, and point-in-time point lookups.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MaterializedTable } from "../../../src/stream/changelog.js";

describe("Stream-Table Duality (MaterializedTable)", () => {
  it("tracks state transitions across INSERT, UPDATE, and DELETE operations", () => {
    const table = new MaterializedTable("accounts");
    const mutations = [];
    table.onMutation((m) => mutations.push(m));

    // 1. Insert
    const m1 = table.applyEvent({ key: "acc-1", value: { balance: 1000 }, offset: 0n });
    assert.strictEqual(m1.op, "INSERT");
    assert.strictEqual(table.get("acc-1").balance, 1000);

    // 2. Update
    const m2 = table.applyEvent({ key: "acc-1", value: { balance: 1500 }, offset: 1n });
    assert.strictEqual(m2.op, "UPDATE");
    assert.strictEqual(m2.prev.balance, 1000);
    assert.strictEqual(table.get("acc-1").balance, 1500);

    // 3. Delete via tombstone
    const m3 = table.applyEvent({ key: "acc-1", value: null, offset: 2n });
    assert.strictEqual(m3.op, "DELETE");
    assert.strictEqual(table.has("acc-1"), false);
    assert.strictEqual(table.get("acc-1"), null);

    assert.strictEqual(mutations.length, 3);
  });
});
