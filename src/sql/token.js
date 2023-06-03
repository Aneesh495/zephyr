/**
 * src/sql/token.js
 *
 * Token definitions and source coordinate tracking for Stream-SQL.
 */

export const TokenType = Object.freeze({
  // Keywords
  SELECT: "SELECT",
  FROM: "FROM",
  WHERE: "WHERE",
  GROUP: "GROUP",
  BY: "BY",
  HAVING: "HAVING",
  WINDOW: "WINDOW",
  TUMBLING: "TUMBLING",
  SLIDING: "SLIDING",
  HOPPING: "HOPPING",
  SESSION: "SESSION",
  SIZE: "SIZE",
  ADVANCE: "ADVANCE",
  TIMEOUT: "TIMEOUT",
  WATERMARK: "WATERMARK",
  DELAY: "DELAY",
  EMIT: "EMIT",
  CHANGES: "CHANGES",
  FINAL: "FINAL",
  AS: "AS",
  AND: "AND",
  OR: "OR",
  NOT: "NOT",
  JOIN: "JOIN",
  ON: "ON",
  INNER: "INNER",
  LEFT: "LEFT",
  WITHIN: "WITHIN",
  SECOND: "SECOND",
  SECONDS: "SECONDS",
  MINUTE: "MINUTE",
  MINUTES: "MINUTES",
  HOUR: "HOUR",
  HOURS: "HOURS",
  MILLIS: "MILLIS",
  PATTERN: "PATTERN",
  MATCH_RECOGNIZE: "MATCH_RECOGNIZE",

  // Literals & Identifiers
  IDENTIFIER: "IDENTIFIER",
  NUMBER: "NUMBER",
  STRING: "STRING",

  // Operators & Delimiters
  COMMA: "COMMA",
  DOT: "DOT",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  SEMICOLON: "SEMICOLON",
  EQ: "EQ",               // =
  NEQ: "NEQ",             // != or <>
  LT: "LT",               // <
  LTE: "LTE",             // <=
  GT: "GT",               // >
  GTE: "GTE",             // >=
  PLUS: "PLUS",           // +
  MINUS: "MINUS",         // -
  STAR: "STAR",           // *
  SLASH: "SLASH",         // /
  ARROW: "ARROW",         // ->
  EOF: "EOF",
});

export class Token {
  /**
   * @param {string} type
   * @param {string} value
   * @param {number} line
   * @param {number} column
   */
  constructor(type, value, line, column) {
    this.type = type;
    this.value = value;
    this.line = line;
    this.column = column;
  }
}
