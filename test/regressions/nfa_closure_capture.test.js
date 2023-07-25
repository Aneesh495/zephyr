/**
 * test/regressions/nfa_closure_capture.test.js
 *
 * Regression test for Bug ZEP-003:
 * In Pattern.compile(), loop variable currNode was captured directly in transition
 * condition closures. When the while loop terminated with currNode = null,
 * evaluating transitions threw: Cannot read properties of null (reading 'condition').
 *
 * Solution: Created block-scoped nodeCondition reference per loop iteration.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Pattern } from "../../src/cep/pattern.js";
import { CEPMatcher } from "../../src/cep/matcher.js";

describe("Regression ZEP-003: NFA Pattern Compiler Closure Capture", () => {
  it("correctly preserves distinct condition predicates across multi-step patterns", () => {
    const pattern = Pattern.begin("STEP1")
      .where((e) => e.step === 1)
      .next("STEP2")
      .where((e) => e.step === 2)
      .next("STEP3")
      .where((e) => e.step === 3);

    const matcher = new CEPMatcher(pattern);

    matcher.process({ step: 1, timestamp: 100n });
    matcher.process({ step: 2, timestamp: 200n });
    const matches = matcher.process({ step: 3, timestamp: 300n });

    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].STEP1[0].step, 1);
    assert.strictEqual(matches[0].STEP2[0].step, 2);
    assert.strictEqual(matches[0].STEP3[0].step, 3);
  });
});
