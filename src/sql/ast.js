/**
 * src/sql/ast.js
 *
 * Abstract Syntax Tree (AST) node representations for Stream-SQL queries,
 * expressions, temporal window clauses, and stream join specifications.
 */

export class ASTNode {
  constructor(type) {
    this.type = type;
  }
}

export class QueryNode extends ASTNode {
  constructor({
    selectList = [],
    from = null,
    join = null,
    where = null,
    groupBy = [],
    window = null,
    having = null,
    emitMode = "CHANGES",
  } = {}) {
    super("QUERY");
    this.selectList = selectList;
    this.from = from;
    this.join = join;
    this.where = where;
    this.groupBy = groupBy;
    this.window = window;
    this.having = having;
    this.emitMode = emitMode;
  }
}

export class SelectItemNode extends ASTNode {
  constructor(expression, alias = null) {
    super("SELECT_ITEM");
    this.expression = expression;
    this.alias = alias;
  }
}

export class BinaryOpNode extends ASTNode {
  constructor(left, operator, right) {
    super("BINARY_OP");
    this.left = left;
    this.operator = operator;
    this.right = right;
  }
}

export class UnaryOpNode extends ASTNode {
  constructor(operator, expression) {
    super("UNARY_OP");
    this.operator = operator;
    this.expression = expression;
  }
}

export class LiteralNode extends ASTNode {
  constructor(value, literalType) {
    super("LITERAL");
    this.value = value;
    this.literalType = literalType; // NUMBER, STRING, BOOLEAN
  }
}

export class IdentifierNode extends ASTNode {
  constructor(name) {
    super("IDENTIFIER");
    this.name = name;
  }
}

export class FunctionCallNode extends ASTNode {
  constructor(name, args = []) {
    super("FUNCTION_CALL");
    this.name = name.toUpperCase();
    this.args = args;
  }
}

export class WindowNode extends ASTNode {
  constructor({ windowType, sizeMs = 0, advanceMs = 0, timeoutMs = 0 }) {
    super("WINDOW");
    this.windowType = windowType; // TUMBLING, SLIDING, HOPPING, SESSION
    this.sizeMs = sizeMs;
    this.advanceMs = advanceMs;
    this.timeoutMs = timeoutMs;
  }
}

export class JoinNode extends ASTNode {
  constructor({ joinType = "INNER", target, condition, withinMs = 0 }) {
    super("JOIN");
    this.joinType = joinType;
    this.target = target;
    this.condition = condition;
    this.withinMs = withinMs;
  }
}
