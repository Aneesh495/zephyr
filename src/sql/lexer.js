/**
 * src/sql/lexer.js
 *
 * Stream-SQL lexical analyzer supporting SQL-92 baseline constructs,
 * streaming window expressions, temporal intervals, and pattern recognition syntax.
 */

import { TokenType, Token } from "./token.js";

const KEYWORDS = new Map([
  ["SELECT", TokenType.SELECT],
  ["FROM", TokenType.FROM],
  ["WHERE", TokenType.WHERE],
  ["GROUP", TokenType.GROUP],
  ["BY", TokenType.BY],
  ["HAVING", TokenType.HAVING],
  ["WINDOW", TokenType.WINDOW],
  ["TUMBLING", TokenType.TUMBLING],
  ["SLIDING", TokenType.SLIDING],
  ["HOPPING", TokenType.HOPPING],
  ["SESSION", TokenType.SESSION],
  ["SIZE", TokenType.SIZE],
  ["ADVANCE", TokenType.ADVANCE],
  ["TIMEOUT", TokenType.TIMEOUT],
  ["WATERMARK", TokenType.WATERMARK],
  ["DELAY", TokenType.DELAY],
  ["EMIT", TokenType.EMIT],
  ["CHANGES", TokenType.CHANGES],
  ["FINAL", TokenType.FINAL],
  ["AS", TokenType.AS],
  ["AND", TokenType.AND],
  ["OR", TokenType.OR],
  ["NOT", TokenType.NOT],
  ["JOIN", TokenType.JOIN],
  ["ON", TokenType.ON],
  ["INNER", TokenType.INNER],
  ["LEFT", TokenType.LEFT],
  ["WITHIN", TokenType.WITHIN],
  ["SECOND", TokenType.SECOND],
  ["SECONDS", TokenType.SECONDS],
  ["MINUTE", TokenType.MINUTE],
  ["MINUTES", TokenType.MINUTES],
  ["HOUR", TokenType.HOUR],
  ["HOURS", TokenType.HOURS],
  ["MILLIS", TokenType.MILLIS],
  ["PATTERN", TokenType.PATTERN],
  ["MATCH_RECOGNIZE", TokenType.MATCH_RECOGNIZE],
]);

export class Lexer {
  /**
   * @param {string} input Source SQL query text
   */
  constructor(input) {
    this.input = input;
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.len = input.length;
  }

  _peek() {
    return this.pos < this.len ? this.input[this.pos] : null;
  }

  _advance() {
    if (this.pos >= this.len) return null;
    const ch = this.input[this.pos++];
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  _skipWhitespaceAndComments() {
    while (this.pos < this.len) {
      const ch = this._peek();
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        this._advance();
      } else if (ch === "-" && this.pos + 1 < this.len && this.input[this.pos + 1] === "-") {
        // Line comment
        while (this.pos < this.len && this._peek() !== "\n") {
          this._advance();
        }
      } else if (ch === "/" && this.pos + 1 < this.len && this.input[this.pos + 1] === "*") {
        // Block comment
        this._advance(); // /
        this._advance(); // *
        while (this.pos + 1 < this.len && !(this.input[this.pos] === "*" && this.input[this.pos + 1] === "/")) {
          this._advance();
        }
        this._advance(); // *
        this._advance(); // /
      } else {
        break;
      }
    }
  }

  /**
   * Tokenizes the complete source input into a Token array.
   *
   * @returns {Array<Token>}
   */
  tokenize() {
    const tokens = [];

    while (this.pos < this.len) {
      this._skipWhitespaceAndComments();
      if (this.pos >= this.len) break;

      const startLine = this.line;
      const startCol = this.column;
      const ch = this._peek();

      // Number
      if (/[0-9]/.test(ch)) {
        let numStr = "";
        while (this.pos < this.len && /[0-9.]/.test(this._peek())) {
          numStr += this._advance();
        }
        tokens.push(new Token(TokenType.NUMBER, numStr, startLine, startCol));
        continue;
      }

      // Identifier or Keyword
      if (/[a-zA-Z_]/.test(ch)) {
        let ident = "";
        while (this.pos < this.len && /[a-zA-Z0-9_]/.test(this._peek())) {
          ident += this._advance();
        }
        const upper = ident.toUpperCase();
        const type = KEYWORDS.get(upper) || TokenType.IDENTIFIER;
        tokens.push(new Token(type, ident, startLine, startCol));
        continue;
      }

      // String literal ('single quote' or "double quote")
      if (ch === "'" || ch === '"') {
        const quote = this._advance();
        let str = "";
        while (this.pos < this.len && this._peek() !== quote) {
          if (this._peek() === "\\") {
            this._advance();
            str += this._advance();
          } else {
            str += this._advance();
          }
        }
        this._advance(); // closing quote
        tokens.push(new Token(TokenType.STRING, str, startLine, startCol));
        continue;
      }

      // Operators and punctuation
      this._advance();
      switch (ch) {
        case ",": tokens.push(new Token(TokenType.COMMA, ",", startLine, startCol)); break;
        case ".": tokens.push(new Token(TokenType.DOT, ".", startLine, startCol)); break;
        case "(": tokens.push(new Token(TokenType.LPAREN, "(", startLine, startCol)); break;
        case ")": tokens.push(new Token(TokenType.RPAREN, ")", startLine, startCol)); break;
        case ";": tokens.push(new Token(TokenType.SEMICOLON, ";", startLine, startCol)); break;
        case "+": tokens.push(new Token(TokenType.PLUS, "+", startLine, startCol)); break;
        case "*": tokens.push(new Token(TokenType.STAR, "*", startLine, startCol)); break;
        case "/": tokens.push(new Token(TokenType.SLASH, "/", startLine, startCol)); break;
        case "-":
          if (this._peek() === ">") {
            this._advance();
            tokens.push(new Token(TokenType.ARROW, "->", startLine, startCol));
          } else {
            tokens.push(new Token(TokenType.MINUS, "-", startLine, startCol));
          }
          break;
        case "=": tokens.push(new Token(TokenType.EQ, "=", startLine, startCol)); break;
        case "!":
          if (this._peek() === "=") {
            this._advance();
            tokens.push(new Token(TokenType.NEQ, "!=", startLine, startCol));
          } else {
            throw new Error(`Unexpected character '!' at line ${startLine}, col ${startCol}`);
          }
          break;
        case "<":
          if (this._peek() === "=") {
            this._advance();
            tokens.push(new Token(TokenType.LTE, "<=", startLine, startCol));
          } else if (this._peek() === ">") {
            this._advance();
            tokens.push(new Token(TokenType.NEQ, "<>", startLine, startCol));
          } else {
            tokens.push(new Token(TokenType.LT, "<", startLine, startCol));
          }
          break;
        case ">":
          if (this._peek() === "=") {
            this._advance();
            tokens.push(new Token(TokenType.GTE, ">=", startLine, startCol));
          } else {
            tokens.push(new Token(TokenType.GT, ">", startLine, startCol));
          }
          break;
        default:
          throw new Error(`Unrecognized token character '${ch}' at line ${startLine}, col ${startCol}`);
      }
    }

    tokens.push(new Token(TokenType.EOF, "", this.line, this.column));
    return tokens;
  }
}
