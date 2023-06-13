/**
 * src/sql/optimizer.js
 *
 * Stream-SQL logical query planner and AST optimizer.
 * Performs constant folding, filter pushdown to source partition iterators,
 * required column projection pruning, and window aggregation compilation.
 */

import { LiteralNode, BinaryOpNode, FunctionCallNode, IdentifierNode } from "./ast.js";

export class PhysicalPlan {
  constructor({
    source,
    requiredColumns = new Set(),
    pushedPredicates = [],
    isAggregate = false,
    aggregations = [],
    scalarProjections = [],
    window = null,
    joinPlan = null,
    emitMode = "CHANGES",
  }) {
    this.source = source;
    this.requiredColumns = requiredColumns;
    this.pushedPredicates = pushedPredicates;
    this.isAggregate = isAggregate;
    this.aggregations = aggregations;
    this.scalarProjections = scalarProjections;
    this.window = window;
    this.joinPlan = joinPlan;
    this.emitMode = emitMode;
  }
}

export class QueryOptimizer {
  /**
   * Optimizes a QueryNode AST and compiles it into an executable PhysicalPlan.
   *
   * @param {import('./ast.js').QueryNode} query
   * @returns {PhysicalPlan}
   */
  optimize(query) {
    const requiredColumns = new Set();
    const aggregations = [];
    const scalarProjections = [];

    // Analyze projections
    for (const item of query.selectList) {
      const expr = this._foldConstants(item.expression);
      this._extractColumns(expr, requiredColumns);

      if (expr instanceof FunctionCallNode && this._isAggregateFunction(expr.name)) {
        aggregations.push({
          func: expr.name,
          arg: expr.args[0] ? this._columnName(expr.args[0]) : "*",
          alias: item.alias || `${expr.name.toLowerCase()}_result`,
        });
      } else {
        scalarProjections.push({
          expr,
          alias: item.alias || (expr instanceof IdentifierNode ? expr.name : "col"),
        });
      }
    }

    // Analyze WHERE for filter pushdown
    const pushedPredicates = [];
    if (query.where) {
      const foldedWhere = this._foldConstants(query.where);
      this._extractColumns(foldedWhere, requiredColumns);

      // Split top-level AND conjuncts
      const conjuncts = this._splitAndConjuncts(foldedWhere);
      for (const conj of conjuncts) {
        pushedPredicates.push(conj);
      }
    }

    // Add group-by columns to required set
    for (const col of query.groupBy) {
      requiredColumns.add(col);
    }

    const isAggregate = aggregations.length > 0 || query.groupBy.length > 0 || query.window !== null;

    let joinPlan = null;
    if (query.join) {
      const foldedJoinCond = this._foldConstants(query.join.condition);
      this._extractColumns(foldedJoinCond, requiredColumns);
      joinPlan = {
        target: query.join.target,
        joinType: query.join.joinType,
        condition: foldedJoinCond,
        withinMs: query.join.withinMs,
      };
    }

    return new PhysicalPlan({
      source: query.from,
      requiredColumns,
      pushedPredicates,
      isAggregate,
      aggregations,
      scalarProjections,
      window: query.window,
      joinPlan,
      emitMode: query.emitMode,
    });
  }

  _isAggregateFunction(name) {
    return ["COUNT", "SUM", "AVG", "MIN", "MAX", "TDIGEST", "QUANTILE"].includes(name.toUpperCase());
  }

  _columnName(node) {
    if (node instanceof IdentifierNode) return node.name;
    return "*";
  }

  _extractColumns(node, set) {
    if (!node) return;
    if (node instanceof IdentifierNode && node.name !== "*") {
      set.add(node.name);
    } else if (node instanceof BinaryOpNode) {
      this._extractColumns(node.left, set);
      this._extractColumns(node.right, set);
    } else if (node instanceof FunctionCallNode) {
      for (const arg of node.args) {
        this._extractColumns(arg, set);
      }
    }
  }

  _splitAndConjuncts(node) {
    if (node instanceof BinaryOpNode && node.operator === "AND") {
      return [...this._splitAndConjuncts(node.left), ...this._splitAndConjuncts(node.right)];
    }
    return [node];
  }

  _foldConstants(node) {
    if (!node) return null;

    if (node instanceof BinaryOpNode) {
      const left = this._foldConstants(node.left);
      const right = this._foldConstants(node.right);

      // If both operands are literals, fold them now
      if (left instanceof LiteralNode && right instanceof LiteralNode) {
        const lv = left.value;
        const rv = right.value;
        switch (node.operator) {
          case "+": return new LiteralNode(lv + rv, "NUMBER");
          case "-": return new LiteralNode(lv - rv, "NUMBER");
          case "*": return new LiteralNode(lv * rv, "NUMBER");
          case "/": return new LiteralNode(lv / rv, "NUMBER");
        }
      }

      return new BinaryOpNode(left, node.operator, right);
    }

    return node;
  }
}
