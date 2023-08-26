# Zephyr Bug Ledger & Root Cause Analyses

This ledger records non-trivial edge cases, concurrency anomalies, and semantic bugs uncovered during the development of Zephyr, along with their formal root cause analyses, applied architectural fixes, and permanent regression test suites.

---

## Index of Recorded Anomalies

| Bug ID | Subsystem | Classification | Severity | Regression Test |
|---|---|---|---|---|
| ZEP-001 | Concurrency | Thread Starvation | High | `test/regressions/barrier_starvation.test.js` |
| ZEP-002 | SQL Parser | Grammar Incompleteness | Medium | `test/regressions/singular_time_unit.test.js` |
| ZEP-003 | CEP Engine | Closure Variable Capture | Critical | `test/regressions/nfa_closure_capture.test.js` |
| ZEP-004 | Cluster | Partition Balancing | High | `test/regressions/sticky_cooperative_balance.test.js` |

---

### ZEP-001: Event-Loop Starvation in Single-Thread SequenceBarrier Wait Loop

#### Description
When executing within the primary Node.js thread context, a synchronous `while(true)` spin-loop in `SequenceBarrier.waitFor()` completely monopolized the V8 execution thread. As a consequence, background asynchronous tasks, I/O callbacks, and `setTimeout` timers were prevented from firing, resulting in an indefinite timeout deadlock.

#### Root Cause
JavaScript execution within a single thread relies on cooperative scheduling via the libuv event loop. A purely synchronous busy-wait loop prevents the event loop from turning, blocking macrotasks and microtasks from progressing.

#### Remediation
Introduced dual synchronization paths:
1. `waitForAsync()`: Uses cooperative `setImmediate()` scheduling on the event loop, allowing background timers and network frames to process concurrently.
2. `waitForSync()`: Preserved specifically for isolated Node.js Worker Threads where dedicated CPU cores spin without blocking the main event loop.

#### Regression Test
`test/regressions/barrier_starvation.test.js`

---

### ZEP-002: Rejection of Singular Temporal Duration Units in Stream-SQL Parser

#### Description
The lexical tokenizer and recursive-descent parser recognized plural duration keywords (`SECONDS`, `MINUTES`, `HOURS`) but failed when queries specified standard singular intervals (e.g., `SIZE 1 MINUTE`, `TIMEOUT 1 SECOND`, `WITHIN 1 HOUR`), throwing unexpected token errors.

#### Root Cause
`TokenType` and `KEYWORDS` map originally contained only plural tokens, causing the tokenizer to categorize singular words as generic `IDENTIFIER` tokens instead of temporal duration units.

#### Remediation
Extended `TokenType` with `SECOND`, `MINUTE`, and `HOUR` tokens. Updated `_parseDurationMs()` in `Parser` to accept both singular and plural forms with appropriate millisecond multipliers.

#### Regression Test
`test/regressions/singular_time_unit.test.js`

---

### ZEP-003: Loop Variable Closure Capture in NFA Pattern Compiler

#### Description
During NFA graph compilation from declarative `Pattern` declarations, transition condition predicates threw runtime errors: `TypeError: Cannot read properties of null (reading 'condition')`.

#### Root Cause
In `Pattern.compile()`, the AST was traversed using a `while (currNode)` loop. The transition condition lambda `(e, ctx) => currNode.condition.filter(e, ctx)` captured the mutable reference `currNode`. When the loop completed and `currNode` became `null`, any subsequent evaluation of transition predicates attempted to access `.condition` on `null`.

#### Remediation
Scoped an immutable block-local variable `const nodeCondition = currNode.condition;` within the loop body. The transition closure now references this persistent node condition, preventing null dereference.

#### Regression Test
`test/regressions/nfa_closure_capture.test.js`

---

### ZEP-004: Sticky Cooperative Partition Assignor Under-Allocation to Newly Joined Consumers

#### Description
When a new consumer joined an existing consumer group, `StickyCooperativeAssignor` retained 100% of all existing assignments because no consumers had departed. As a result, the new consumer received zero partitions despite having idle cluster capacity.

#### Root Cause
The assignor lacked a fair-share quota cap when preserving historical ownership. Existing consumers kept all previously assigned partitions as long as they remained below an unconstrained maximum.

#### Remediation
Implemented fair quota balancing based on integer division: `minPerConsumer = Math.floor(total / N)` and `remainder = total % N`. Existing consumers are permitted to retain at most `minPerConsumer + 1` partitions (up to the remaining surplus allowance), and any surplus partitions are revoked and redistributed to underserved consumers.

#### Regression Test
`test/regressions/sticky_cooperative_balance.test.js`
