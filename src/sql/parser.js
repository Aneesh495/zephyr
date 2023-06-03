/**
 * src/sql/parser.js
 *
 * Recursive-descent parser compiling Stream-SQL query tokens into structured AST nodes.
 * Supports streaming SELECT queries, temporal tumbling/sliding/session windows,
 * stream-to-stream equi-joins with WITHIN constraints, and EMIT specifications.
 */

import { TokenType } from "./token.js";
import {
  QueryNode,
  SelectItemNode,
  BinaryOpNode,
  UnaryOpNode,
  LiteralNode,
  IdentifierNode,
  FunctionCallNode,
  WindowNode,
  JoinNode,
} from "./ast.js";

export class Parser {
  /**
   * @param {Array<import('./token.js').Token>} tokens
   */
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  _current() {
    return this.tokens[this.pos];
  }

  _peek() {
    return this.tokens[this.pos + 1];
  }

  _match(expectedType) {
    if (this._current().type === expectedType) {
      const tok = this._current();
      this.pos++;
      return tok;
    }
    return null;
  }

  _expect(expectedType, message = "") {
    const tok = this._match(expectedType);
    if (!tok) {
      const cur = this._current();
      throw new Error(
        `Syntax Error at line ${cur.line}, col ${cur.column}: Expected ${expectedType}, found ${cur.type} (${cur.value}). ${message}`
      );
    }
    return tok;
  }

  /**
   * Parses the root Stream-SQL query.
   *
   * @returns {QueryNode}
   */
  parse() {
    this._expect(TokenType.SELECT);
    const selectList = this._parseSelectList();

    this._expect(TokenType.FROM);
    const fromToken = this._expect(TokenType.IDENTIFIER, "Expected stream table identifier");
    const from = fromToken.value;

    let join = null;
    if (this._match(TokenType.JOIN) || this._match(TokenType.INNER) || this._match(TokenType.LEFT)) {
      join = this._parseJoin();
    }

    let where = null;
    if (this._match(TokenType.WHERE)) {
      where = this._parseExpression();
    }

    const groupBy = [];
    let window = null;

    if (this._match(TokenType.GROUP)) {
      this._expect(TokenType.BY);
      while (true) {
        if (this._current().type === TokenType.WINDOW) {
          window = this._parseWindowClause();
        } else {
          const colToken = this._expect(TokenType.IDENTIFIER);
          groupBy.push(colToken.value);
        }

        if (!this._match(TokenType.COMMA)) {
          break;
        }
      }
    }

    let emitMode = "CHANGES";
    if (this._match(TokenType.EMIT)) {
      if (this._match(TokenType.CHANGES)) {
        emitMode = "CHANGES";
      } else if (this._match(TokenType.FINAL)) {
        emitMode = "FINAL";
      }
    }

    this._match(TokenType.SEMICOLON);

    return new QueryNode({
      selectList,
      from,
      join,
      where,
      groupBy,
      window,
      emitMode,
    });
  }

  _parseSelectList() {
    const list = [];
    while (true) {
      if (this._match(TokenType.STAR)) {
        list.push(new SelectItemNode(new IdentifierNode("*"), "*"));
      } else {
        const expr = this._parseExpression();
        let alias = null;
        if (this._match(TokenType.AS)) {
          alias = this._expect(TokenType.IDENTIFIER).value;
        } else if (this._current().type === TokenType.IDENTIFIER) {
          alias = this._current().value;
          this.pos++;
        }
        list.push(new SelectItemNode(expr, alias));
      }

      if (!this._match(TokenType.COMMA)) {
        break;
      }
    }
    return list;
  }

  _parseWindowClause() {
    this._expect(TokenType.WINDOW);
    this._expect(TokenType.LPAREN);

    const typeTok = this._current();
    let windowType = "TUMBLING";
    let sizeMs = 0;
    let advanceMs = 0;
    let timeoutMs = 0;

    if (this._match(TokenType.TUMBLING)) {
      windowType = "TUMBLING";
      this._expect(TokenType.COMMA);
      this._expect(TokenType.SIZE);
      sizeMs = this._parseDurationMs();
    } else if (this._match(TokenType.SLIDING) || this._match(TokenType.HOPPING)) {
      windowType = "SLIDING";
      this._expect(TokenType.COMMA);
      this._expect(TokenType.SIZE);
      sizeMs = this._parseDurationMs();
      this._expect(TokenType.COMMA);
      this._expect(TokenType.ADVANCE);
      advanceMs = this._parseDurationMs();
    } else if (this._match(TokenType.SESSION)) {
      windowType = "SESSION";
      this._expect(TokenType.COMMA);
      this._expect(TokenType.TIMEOUT);
      timeoutMs = this._parseDurationMs();
    } else {
      throw new Error(`Unsupported window type: ${typeTok.value}`);
    }

    this._expect(TokenType.RPAREN);

    return new WindowNode({
      windowType,
      sizeMs,
      advanceMs,
      timeoutMs,
    });
  }

  _parseDurationMs() {
    const numTok = this._expect(TokenType.NUMBER);
    const val = parseFloat(numTok.value);

    let multiplier = 1000; // default seconds
    if (this._match(TokenType.SECOND) || this._match(TokenType.SECONDS)) {
      multiplier = 1000;
    } else if (this._match(TokenType.MINUTE) || this._match(TokenType.MINUTES)) {
      multiplier = 60 * 1000;
    } else if (this._match(TokenType.HOUR) || this._match(TokenType.HOURS)) {
      multiplier = 3600 * 1000;
    } else if (this._match(TokenType.MILLIS)) {
      multiplier = 1;
    }

    return Math.floor(val * multiplier);
  }

  _parseJoin() {
    const targetTok = this._expect(TokenType.IDENTIFIER, "Expected join target stream");
    const target = targetTok.value;

    this._expect(TokenType.ON);
    const condition = this._parseExpression();

    let withinMs = 0;
    if (this._match(TokenType.WITHIN)) {
      withinMs = this._parseDurationMs();
    }

    return new JoinNode({
      target,
      condition,
      withinMs,
    });
  }

  _parseExpression() {
    return this._parseOr();
  }

  _parseOr() {
    let left = this._parseAnd();
    while (this._match(TokenType.OR)) {
      const right = this._parseAnd();
      left = new BinaryOpNode(left, "OR", right);
    }
    return left;
  }

  _parseAnd() {
    let left = this._parseComparison();
    while (this._match(TokenType.AND)) {
      const right = this._parseComparison();
      left = new BinaryOpNode(left, "AND", right);
    }
    return left;
  }

  _parseComparison() {
    let left = this._parseAdditive();
    const cur = this._current();
    if (
      cur.type === TokenType.EQ ||
      cur.type === TokenType.NEQ ||
      cur.type === TokenType.LT ||
      cur.type === TokenType.LTE ||
      cur.type === TokenType.GT ||
      cur.type === TokenType.GTE
    ) {
      this.pos++;
      const right = this._parseAdditive();
      left = new BinaryOpNode(left, cur.value, right);
    }
    return left;
  }

  _parseAdditive() {
    let left = this._parseMultiplicative();
    while (this._current().type === TokenType.PLUS || this._current().type === TokenType.MINUS) {
      const op = this._current().value;
      this.pos++;
      const right = this._parseMultiplicative();
      left = new BinaryOpNode(left, op, right);
    }
    return left;
  }

  _parseMultiplicative() {
    let left = this._parsePrimary();
    while (this._current().type === TokenType.STAR || this._current().type === TokenType.SLASH) {
      const op = this._current().value;
      this.pos++;
      const right = this._parsePrimary();
      left = new BinaryOpNode(left, op, right);
    }
    return left;
  }

  _parsePrimary() {
    const cur = this._current();

    if (this._match(TokenType.LPAREN)) {
      const expr = this._parseExpression();
      this._expect(TokenType.RPAREN);
      return expr;
    }

    if (cur.type === TokenType.NUMBER) {
      this.pos++;
      return new LiteralNode(parseFloat(cur.value), "NUMBER");
    }

    if (cur.type === TokenType.STRING) {
      this.pos++;
      return new LiteralNode(cur.value, "STRING");
    }

    if (cur.type === TokenType.IDENTIFIER) {
      this.pos++;
      // Check for function call
      if (this._match(TokenType.LPAREN)) {
        const args = [];
        if (this._current().type !== TokenType.RPAREN) {
          while (true) {
            if (this._match(TokenType.STAR)) {
              args.push(new IdentifierNode("*"));
            } else {
              args.push(this._parseExpression());
            }
            if (!this._match(TokenType.COMMA)) break;
          }
        }
        this._expect(TokenType.RPAREN);
        return new FunctionCallNode(cur.value, args);
      }

      // Check for member access like table.column
      if (this._match(TokenType.DOT)) {
        const fieldTok = this._expect(TokenType.IDENTIFIER);
        return new IdentifierNode(`${cur.value}.${fieldTok.value}`);
      }

      return new IdentifierNode(cur.value);
    }

    throw new Error(`Unexpected expression token '${cur.value}' (${cur.type}) at line ${cur.line}, col ${cur.column}`);
  }
}
