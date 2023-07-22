/**
 * src/cep/condition.js
 *
 * Predicate condition evaluators for Complex Event Processing pattern nodes.
 * Supports SimpleCondition (independent event inspection) and
 * IterativeCondition (cross-event comparative correlation).
 */

export class SimpleCondition {
  /**
   * @param {function(object): boolean} predicate
   */
  constructor(predicate) {
    this.predicate = predicate;
  }

  filter(event) {
    return Boolean(this.predicate(event));
  }
}

export class IterativeCondition {
  /**
   * @param {function(object, object): boolean} predicate (currentEvent, patternContext) => boolean
   */
  constructor(predicate) {
    this.predicate = predicate;
  }

  filter(event, context) {
    return Boolean(this.predicate(event, context));
  }
}
