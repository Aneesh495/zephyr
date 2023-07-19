/**
 * src/cep/nfa.js
 *
 * Non-deterministic Finite Automaton with Epsilon Transitions (NFA-e) for Complex Event Processing.
 * Models states, TAKE/IGNORE/PROCEED transitions, and active computation instances.
 */

export const StateType = Object.freeze({
  START: "START",
  NORMAL: "NORMAL",
  STOP: "STOP",
  FINAL: "FINAL",
});

export const TransitionType = Object.freeze({
  TAKE: "TAKE",       // Consumes event and advances state
  IGNORE: "IGNORE",   // Skips event and remains in current state (relaxed contiguity)
  PROCEED: "PROCEED", // Epsilon transition to next state without consuming event
});

export class NFATransition {
  /**
   * @param {string} sourceState
   * @param {string} targetState
   * @param {string} action TAKE, IGNORE, or PROCEED
   * @param {function(object, object): boolean} [condition] Predicate taking (currentEvent, matchedHistory)
   */
  constructor(sourceState, targetState, action, condition = () => true) {
    this.sourceState = sourceState;
    this.targetState = targetState;
    this.action = action;
    this.condition = condition;
  }
}

export class NFAState {
  /**
   * @param {string} name State identifier
   * @param {string} stateType START, NORMAL, STOP, FINAL
   */
  constructor(name, stateType = StateType.NORMAL) {
    this.name = name;
    this.stateType = stateType;
    /** @type {Array<NFATransition>} */
    this.transitions = [];
  }

  addTransition(transition) {
    this.transitions.push(transition);
  }

  isFinal() {
    return this.stateType === StateType.FINAL;
  }

  isStart() {
    return this.stateType === StateType.START;
  }
}

export class ComputationInstance {
  /**
   * Represents an in-flight partial pattern match.
   *
   * @param {string} currentState
   * @param {object} [matchedEvents={}] Map of pattern name -> array of events
   * @param {bigint} [startTimestamp=0n]
   */
  constructor(currentState, matchedEvents = {}, startTimestamp = 0n) {
    this.currentState = currentState;
    this.matchedEvents = { ...matchedEvents };
    this.startTimestamp = startTimestamp;
  }

  clone() {
    const copyMatches = {};
    for (const [k, v] of Object.entries(this.matchedEvents)) {
      copyMatches[k] = Array.isArray(v) ? [...v] : [v];
    }
    return new ComputationInstance(this.currentState, copyMatches, this.startTimestamp);
  }
}
