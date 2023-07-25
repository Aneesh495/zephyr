/**
 * test/unit/cep/matcher.test.js
 *
 * Verifies CEPMatcher NFA-e execution across strict contiguity,
 * relaxed contiguity, Kleene quantifiers, and temporal within deadlines.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pattern } from "../../../src/cep/pattern.js";
import { CEPMatcher } from "../../../src/cep/matcher.js";

describe("Complex Event Processing (CEP) Matcher Engine", () => {
  it("matches strict sequence A -> B without intervening noise", () => {
    // Pattern: A followed strictly by B
    const pattern = Pattern.begin("A")
      .where((e) => e.type === "LOGIN_FAILED")
      .next("B")
      .where((e) => e.type === "ACCOUNT_LOCKED");

    const matcher = new CEPMatcher(pattern);

    const m1 = matcher.process({ type: "LOGIN_FAILED", user: "alice", timestamp: 1000n });
    assert.strictEqual(m1.length, 0);

    const m2 = matcher.process({ type: "ACCOUNT_LOCKED", user: "alice", timestamp: 1100n });
    assert.strictEqual(m2.length, 1);
    assert.strictEqual(m2[0].A[0].user, "alice");
    assert.strictEqual(m2[0].B[0].user, "alice");
  });

  it("matches relaxed contiguity A -> followedBy(B) across intervening noise events", () => {
    // Pattern: A followedBy B
    const pattern = Pattern.begin("A")
      .where((e) => e.type === "SENSOR_ALERT")
      .followedBy("B")
      .where((e) => e.type === "SHUTDOWN_SIGNAL");

    const matcher = new CEPMatcher(pattern);

    matcher.process({ type: "SENSOR_ALERT", temp: 100, timestamp: 1000n });
    // Intervening noise events
    matcher.process({ type: "HEARTBEAT", timestamp: 1500n });
    matcher.process({ type: "METRIC_REPORT", timestamp: 1800n });

    const matches = matcher.process({ type: "SHUTDOWN_SIGNAL", timestamp: 2000n });
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].A[0].temp, 100);
    assert.strictEqual(matches[0].B[0].type, "SHUTDOWN_SIGNAL");
  });

  it("enforces temporal within deadlines and purges expired partial matches", () => {
    const pattern = Pattern.begin("START")
      .where((e) => e.action === "AUTH_ATTEMPT")
      .followedBy("COMPLETE")
      .where((e) => e.action === "AUTH_SUCCESS")
      .within(2000); // 2 second deadline

    const matcher = new CEPMatcher(pattern);

    matcher.process({ action: "AUTH_ATTEMPT", timestamp: 1000n });

    // Arrives at t = 4000 (elapsed 3000ms > 2000ms deadline)
    const matches = matcher.process({ action: "AUTH_SUCCESS", timestamp: 4000n });
    assert.strictEqual(matches.length, 0, "Expired partial match must not complete");
  });

  it("handles Kleene oneOrMore quantifier A -> B+ -> C", () => {
    const pattern = Pattern.begin("A")
      .where((e) => e.val === "A")
      .followedBy("B")
      .where((e) => e.val === "B")
      .oneOrMore()
      .followedBy("C")
      .where((e) => e.val === "C");

    const matcher = new CEPMatcher(pattern);

    matcher.process({ val: "A", timestamp: 1000n });
    matcher.process({ val: "B", timestamp: 1100n });
    matcher.process({ val: "B", timestamp: 1200n });

    const matches = matcher.process({ val: "C", timestamp: 1300n });
    assert.ok(matches.length >= 1);
    assert.strictEqual(matches[0].A[0].val, "A");
    assert.ok(matches[0].B.length >= 2);
    assert.strictEqual(matches[0].C[0].val, "C");
  });
});
