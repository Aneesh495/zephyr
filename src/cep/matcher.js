/**
 * src/cep/matcher.js
 *
 * Complex Event Processing runtime executing NFA-e graphs across arriving stream events.
 * Manages concurrent partial computation instances, enforces temporal within deadlines,
 * and emits completed pattern match sequences.
 */

import { ComputationInstance, TransitionType } from "./nfa.js";

export class CEPMatcher {
  /**
   * @param {import('./pattern.js').Pattern} pattern
   */
  constructor(pattern) {
    this.pattern = pattern;
    this.nfa = pattern.compile();
    /** @type {Array<ComputationInstance>} */
    this.instances = [];
  }

  /**
   * Ingests an event and advances NFA computation instances.
   *
   * @param {object} event Stream event with timestamp
   * @returns {Array<object>} List of completed matches
   */
  process(event) {
    const eventTs = BigInt(event.timestamp ?? Date.now());
    const completedMatches = [];
    const nextInstances = [];

    // Step 1: Advance existing partial match instances
    for (const inst of this.instances) {
      // Check within timeout deadline
      if (this.nfa.withinMs > 0) {
        const elapsed = Number(eventTs - inst.startTimestamp);
        if (elapsed > this.nfa.withinMs) {
          continue; // Expired, discard partial match
        }
      }

      const currentState = this.nfa.states.get(inst.currentState);
      if (!currentState) continue;

      for (const trans of currentState.transitions) {
        if (trans.action === TransitionType.TAKE) {
          if (trans.condition(event, inst.matchedEvents)) {
            const nextInst = inst.clone();
            nextInst.currentState = trans.targetState;
            if (!nextInst.matchedEvents[trans.targetState]) {
              nextInst.matchedEvents[trans.targetState] = [];
            }
            nextInst.matchedEvents[trans.targetState].push(event);

            // Check if reached a state with PROCEED to $final
            const target = this.nfa.states.get(trans.targetState);
            const proceedToFinal = target?.transitions.find(
              (t) => t.action === TransitionType.PROCEED && t.targetState === "$final"
            );

            if (proceedToFinal) {
              completedMatches.push({ ...nextInst.matchedEvents });
            } else {
              nextInstances.push(nextInst);
            }
          }
        } else if (trans.action === TransitionType.IGNORE) {
          // Keep current instance waiting (relaxed contiguity)
          nextInstances.push(inst.clone());
        }
      }
    }

    // Step 2: Test start transitions to spawn new candidate instances
    const startState = this.nfa.states.get(this.nfa.startState);
    if (startState) {
      for (const trans of startState.transitions) {
        if (trans.action === TransitionType.TAKE && trans.condition(event, {})) {
          const newInst = new ComputationInstance(trans.targetState, {}, eventTs);
          newInst.matchedEvents[trans.targetState] = [event];

          const target = this.nfa.states.get(trans.targetState);
          const proceedToFinal = target?.transitions.find(
            (t) => t.action === TransitionType.PROCEED && t.targetState === "$final"
          );

          if (proceedToFinal) {
            completedMatches.push({ ...newInst.matchedEvents });
          } else {
            nextInstances.push(newInst);
          }
        }
      }
    }

    this.instances = nextInstances;
    return completedMatches;
  }
}
