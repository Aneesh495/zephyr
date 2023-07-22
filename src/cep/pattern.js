/**
 * src/cep/pattern.js
 *
 * Declarative pattern definition builder and NFA compiler for Complex Event Processing.
 * Supports strict contiguity (next), relaxed contiguity (followedBy),
 * Kleene quantifiers (oneOrMore, times), and temporal deadlines (within).
 */

import { NFAState, NFATransition, StateType, TransitionType } from "./nfa.js";
import { SimpleCondition } from "./condition.js";

export const Contiguity = Object.freeze({
  STRICT: "STRICT",
  RELAXED: "RELAXED",
});

export class PatternNode {
  /**
   * @param {string} name
   * @param {string} contiguity
   */
  constructor(name, contiguity = Contiguity.STRICT) {
    this.name = name;
    this.contiguity = contiguity;
    this.condition = null;
    this.isKleene = false;
    this.repeatCount = 1;
    this.next = null;
  }

  where(predicate) {
    this.condition = predicate instanceof SimpleCondition ? predicate : new SimpleCondition(predicate);
    return this;
  }

  oneOrMore() {
    this.isKleene = true;
    return this;
  }

  times(count) {
    this.repeatCount = count;
    return this;
  }
}

export class Pattern {
  constructor(rootNode) {
    this.root = rootNode;
    this.current = rootNode;
    this.withinMs = 0;
  }

  static begin(name) {
    const node = new PatternNode(name, Contiguity.STRICT);
    return new Pattern(node);
  }

  where(predicate) {
    this.current.where(predicate);
    return this;
  }

  next(name) {
    const node = new PatternNode(name, Contiguity.STRICT);
    this.current.next = node;
    this.current = node;
    return this;
  }

  followedBy(name) {
    const node = new PatternNode(name, Contiguity.RELAXED);
    this.current.next = node;
    this.current = node;
    return this;
  }

  oneOrMore() {
    this.current.oneOrMore();
    return this;
  }

  times(count) {
    this.current.times(count);
    return this;
  }

  within(ms) {
    this.withinMs = Number(ms);
    return this;
  }

  /**
   * Compiles this pattern declaration into an executable NFA state graph.
   *
   * @returns {{ states: Map<string, NFAState>, startState: string, withinMs: number }}
   */
  compile() {
    const states = new Map();
    const startState = new NFAState("$start", StateType.START);
    states.set(startState.name, startState);

    let prevStates = [startState];
    let currNode = this.root;

    while (currNode) {
      const stateName = currNode.name;
      const nfaState = new NFAState(stateName, StateType.NORMAL);
      states.set(stateName, nfaState);

      const nodeCondition = currNode.condition;
      const cond = nodeCondition ? (e, ctx) => nodeCondition.filter(e, ctx) : () => true;

      for (const p of prevStates) {
        // TAKE transition
        p.addTransition(new NFATransition(p.name, stateName, TransitionType.TAKE, cond));
        // If relaxed contiguity and not start state, allow IGNORE loop
        if (currNode.contiguity === Contiguity.RELAXED && !p.isStart()) {
          p.addTransition(new NFATransition(p.name, p.name, TransitionType.IGNORE));
        }
      }

      if (currNode.isKleene) {
        // Kleene self-loop
        nfaState.addTransition(new NFATransition(stateName, stateName, TransitionType.TAKE, cond));
      }

      prevStates = [nfaState];
      currNode = currNode.next;
    }

    // Add FINAL state
    const finalState = new NFAState("$final", StateType.FINAL);
    states.set(finalState.name, finalState);

    for (const p of prevStates) {
      p.addTransition(new NFATransition(p.name, finalState.name, TransitionType.PROCEED));
    }

    return {
      states,
      startState: startState.name,
      withinMs: this.withinMs,
    };
  }
}
