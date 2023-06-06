/**
 * test/regressions/singular_time_unit.test.js
 *
 * Regression test for Bug ZEP-002:
 * Parser rejected singular time units ("1 MINUTE", "1 SECOND", "1 HOUR")
 * expecting only plural ("MINUTES", "SECONDS", "HOURS").
 *
 * Solution: Extended TokenType, Lexer, and Parser to treat singular and plural
 * temporal duration keywords interchangeably.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../src/sql/lexer.js";
import { Parser } from "../../src/sql/parser.js";

describe("Regression ZEP-002: Singular Temporal Duration Units", () => {
  it("parses queries specifying 1 SECOND, 1 MINUTE, and 1 HOUR without syntax failure", () => {
    const q1 = "SELECT * FROM s GROUP BY WINDOW(TUMBLING, SIZE 1 SECOND);";
    const q2 = "SELECT * FROM s GROUP BY WINDOW(TUMBLING, SIZE 1 MINUTE);";
    const q3 = "SELECT * FROM s GROUP BY WINDOW(TUMBLING, SIZE 1 HOUR);";

    for (const [sql, expectedMs] of [[q1, 1000], [q2, 60000], [q3, 3600000]]) {
      const lexer = new Lexer(sql);
      const parser = new Parser(lexer.tokenize());
      const ast = parser.parse();
      assert.strictEqual(ast.window.sizeMs, expectedMs);
    }
  });
});
