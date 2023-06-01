/**
 * test/unit/sql/lexer.test.js
 *
 * Verifies Stream-SQL lexical analyzer keyword classification,
 * streaming window operators, comments, and literal tokenization.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Lexer } from "../../../src/sql/lexer.js";
import { TokenType } from "../../../src/sql/token.js";

describe("Stream-SQL Lexical Analyzer", () => {
  it("tokenizes baseline streaming query with tumbling window", () => {
    const sql = `
      SELECT device_id, COUNT(*) AS event_count, AVG(temperature) AS avg_temp
      FROM sensor_stream
      WHERE status = 'ACTIVE' AND temperature > 25.5
      GROUP BY device_id, WINDOW(TUMBLING, SIZE 10 SECONDS)
      EMIT CHANGES;
    `;

    const lexer = new Lexer(sql);
    const tokens = lexer.tokenize();

    assert.ok(tokens.length > 0);
    assert.strictEqual(tokens[0].type, TokenType.SELECT);

    const types = tokens.map((t) => t.type);
    assert.ok(types.includes(TokenType.FROM));
    assert.ok(types.includes(TokenType.WHERE));
    assert.ok(types.includes(TokenType.GROUP));
    assert.ok(types.includes(TokenType.WINDOW));
    assert.ok(types.includes(TokenType.TUMBLING));
    assert.ok(types.includes(TokenType.SECONDS));
    assert.ok(types.includes(TokenType.EMIT));
    assert.ok(types.includes(TokenType.CHANGES));
    assert.strictEqual(types[types.length - 1], TokenType.EOF);
  });

  it("skips single-line and multi-line comments cleanly", () => {
    const sql = `
      -- Single line comment
      SELECT 123 /* inline comment */ FROM orders;
    `;
    const lexer = new Lexer(sql);
    const tokens = lexer.tokenize();

    assert.strictEqual(tokens[0].type, TokenType.SELECT);
    assert.strictEqual(tokens[1].type, TokenType.NUMBER);
    assert.strictEqual(tokens[1].value, "123");
    assert.strictEqual(tokens[2].type, TokenType.FROM);
    assert.strictEqual(tokens[3].type, TokenType.IDENTIFIER);
    assert.strictEqual(tokens[3].value, "orders");
  });

  it("lexes comparison and arrow operators", () => {
    const sql = "a != b AND c <= d AND e >= f AND g -> h";
    const lexer = new Lexer(sql);
    const tokens = lexer.tokenize();

    const opTypes = tokens.map((t) => t.type);
    assert.ok(opTypes.includes(TokenType.NEQ));
    assert.ok(opTypes.includes(TokenType.LTE));
    assert.ok(opTypes.includes(TokenType.GTE));
    assert.ok(opTypes.includes(TokenType.ARROW));
  });
});
