/**
 * test/unit/sql/parser.test.js
 *
 * Verifies Stream-SQL recursive-descent parser AST creation,
 * tumbling/sliding/session window clauses, and stream join constraints.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../../src/sql/lexer.js";
import { Parser } from "../../../src/sql/parser.js";

function parseQuery(sql) {
  const lexer = new Lexer(sql);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

describe("Stream-SQL Recursive-Descent Parser", () => {
  it("parses tumbling window aggregation query into structured AST", () => {
    const sql = `
      SELECT symbol, COUNT(*) AS trade_count, AVG(price) AS vwap
      FROM trades
      WHERE price > 100.0 AND status = 'FILLED'
      GROUP BY symbol, WINDOW(TUMBLING, SIZE 5 SECONDS)
      EMIT CHANGES;
    `;

    const ast = parseQuery(sql);
    assert.strictEqual(ast.from, "trades");
    assert.strictEqual(ast.selectList.length, 3);
    assert.strictEqual(ast.selectList[0].alias, null);
    assert.strictEqual(ast.selectList[1].alias, "trade_count");
    assert.strictEqual(ast.selectList[2].alias, "vwap");

    assert.ok(ast.where !== null);
    assert.strictEqual(ast.where.operator, "AND");

    assert.deepStrictEqual(ast.groupBy, ["symbol"]);
    assert.ok(ast.window !== null);
    assert.strictEqual(ast.window.windowType, "TUMBLING");
    assert.strictEqual(ast.window.sizeMs, 5000);
    assert.strictEqual(ast.emitMode, "CHANGES");
  });

  it("parses sliding window query with size and advance intervals", () => {
    const sql = `
      SELECT sensor_id, MAX(reading)
      FROM telemetry
      GROUP BY sensor_id, WINDOW(SLIDING, SIZE 10 MINUTES, ADVANCE 1 MINUTE)
      EMIT FINAL;
    `;

    const ast = parseQuery(sql);
    assert.strictEqual(ast.window.windowType, "SLIDING");
    assert.strictEqual(ast.window.sizeMs, 600000);
    assert.strictEqual(ast.window.advanceMs, 60000);
    assert.strictEqual(ast.emitMode, "FINAL");
  });

  it("parses session window query with inactivity timeout", () => {
    const sql = `
      SELECT user_id, COUNT(*)
      FROM user_clicks
      GROUP BY user_id, WINDOW(SESSION, TIMEOUT 30 SECONDS);
    `;

    const ast = parseQuery(sql);
    assert.strictEqual(ast.window.windowType, "SESSION");
    assert.strictEqual(ast.window.timeoutMs, 30000);
  });

  it("parses temporal stream-to-stream equi-join with WITHIN bound", () => {
    const sql = `
      SELECT orders.id, shipments.tracking_number
      FROM orders
      JOIN shipments ON orders.id = shipments.order_id WITHIN 15 MINUTES;
    `;

    const ast = parseQuery(sql);
    assert.strictEqual(ast.from, "orders");
    assert.ok(ast.join !== null);
    assert.strictEqual(ast.join.target, "shipments");
    assert.strictEqual(ast.join.withinMs, 900000);
    assert.strictEqual(ast.join.condition.operator, "=");
  });

  it("correctly models binary operator precedence in mathematical and logical expressions", () => {
    // 2 + 3 * 4 should parse as 2 + (3 * 4)
    const sql = "SELECT 2 + 3 * 4 AS calc FROM dummy;";
    const ast = parseQuery(sql);
    const expr = ast.selectList[0].expression;

    assert.strictEqual(expr.operator, "+");
    assert.strictEqual(expr.left.value, 2);
    assert.strictEqual(expr.right.operator, "*");
    assert.strictEqual(expr.right.left.value, 3);
    assert.strictEqual(expr.right.right.value, 4);
  });
});
