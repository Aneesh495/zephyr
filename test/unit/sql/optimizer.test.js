/**
 * test/unit/sql/optimizer.test.js
 *
 * Verifies QueryOptimizer constant folding, projection pruning,
 * filter pushdown conjunct extraction, and physical execution plan compilation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../../src/sql/lexer.js";
import { Parser } from "../../../src/sql/parser.js";
import { QueryOptimizer } from "../../../src/sql/optimizer.js";
import { LiteralNode } from "../../../src/sql/ast.js";

function optimizeSql(sql) {
  const tokens = new Lexer(sql).tokenize();
  const ast = new Parser(tokens).parse();
  const opt = new QueryOptimizer();
  return opt.optimize(ast);
}

describe("Stream-SQL Query Optimizer & Logical Planner", () => {
  it("folds constant mathematical expressions during optimization pass", () => {
    const sql = "SELECT price, 10 * 5 AS multiplier FROM trades WHERE price > 20 + 5;";
    const plan = optimizeSql(sql);

    // 10 * 5 must fold to 50
    const proj = plan.scalarProjections.find((p) => p.alias === "multiplier");
    assert.ok(proj.expr instanceof LiteralNode);
    assert.strictEqual(proj.expr.value, 50);

    // 20 + 5 must fold to 25
    const pred = plan.pushedPredicates[0];
    assert.strictEqual(pred.right.value, 25);
  });

  it("extracts exact minimal set of required columns for projection pruning", () => {
    const sql = `
      SELECT symbol, AVG(price) AS avg_price
      FROM trades
      WHERE volume > 1000
      GROUP BY symbol, WINDOW(TUMBLING, SIZE 5 SECONDS);
    `;
    const plan = optimizeSql(sql);

    // Required columns must be: symbol, price, volume
    assert.ok(plan.requiredColumns.has("symbol"));
    assert.ok(plan.requiredColumns.has("price"));
    assert.ok(plan.requiredColumns.has("volume"));
    assert.strictEqual(plan.requiredColumns.size, 3);
  });

  it("splits multiple AND predicates into distinct pushed down filters", () => {
    const sql = "SELECT * FROM orders WHERE status = 'COMPLETED' AND amount >= 500 AND country = 'US';";
    const plan = optimizeSql(sql);

    assert.strictEqual(plan.pushedPredicates.length, 3);
    assert.strictEqual(plan.pushedPredicates[0].left.name, "status");
    assert.strictEqual(plan.pushedPredicates[1].left.name, "amount");
    assert.strictEqual(plan.pushedPredicates[2].left.name, "country");
  });
});
