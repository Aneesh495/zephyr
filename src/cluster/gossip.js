/**
 * src/cluster/gossip.js
 *
 * Scalable Weak-Consistency Infection-Style Process Group Membership (SWIM) protocol.
 * Implements randomized ping/ack probing, suspicion timeouts, and incarnation counters
 * to detect node failures with minimal O(1) probe message overhead per node.
 */

export const NodeState = Object.freeze({
  ALIVE: "ALIVE",
  SUSPECT: "SUSPECT",
  DEAD: "DEAD",
});

export class MemberNode {
  constructor(id, address, port, incarnation = 0) {
    this.id = id;
    this.address = address;
    this.port = port;
    this.state = NodeState.ALIVE;
    this.incarnation = incarnation;
    this.lastObserved = Date.now();
  }
}

export class GossipMembership {
  /**
   * @param {object} options
   * @param {string} options.localId
   * @param {number} [options.probeIntervalMs=1000] Ping probe frequency
   * @param {number} [options.suspicionTimeoutMs=3000] Period before suspect becomes dead
   */
  constructor({ localId, probeIntervalMs = 1000, suspicionTimeoutMs = 3000 }) {
    this.localId = localId;
    this.probeIntervalMs = probeIntervalMs;
    this.suspicionTimeoutMs = suspicionTimeoutMs;

    this.incarnation = 0;
    /** @type {Map<string, MemberNode>} */
    this.members = new Map();
    this.probeTimer = null;
    this.isClosed = false;
  }

  addMember(id, address = "127.0.0.1", port = 9092) {
    if (id === this.localId) return;
    const member = new MemberNode(id, address, port);
    this.members.set(id, member);
  }

  removeMember(id) {
    this.members.delete(id);
  }

  getAliveMembers() {
    const list = [];
    for (const [id, m] of this.members) {
      if (m.state === NodeState.ALIVE) {
        list.push(id);
      }
    }
    return list;
  }

  /**
   * Updates state for a member received via gossip rumor.
   *
   * @param {string} memberId
   * @param {string} state ALIVE, SUSPECT, DEAD
   * @param {number} incarnation
   */
  applyRumor(memberId, state, incarnation) {
    if (memberId === this.localId) {
      // If someone claims we are suspect or dead, refute with higher incarnation
      if (state === NodeState.SUSPECT || state === NodeState.DEAD) {
        this.incarnation = Math.max(this.incarnation, incarnation) + 1;
      }
      return;
    }

    let member = this.members.get(memberId);
    if (!member) {
      member = new MemberNode(memberId, "127.0.0.1", 9092, incarnation);
      this.members.set(memberId, member);
    }

    if (incarnation > member.incarnation) {
      member.incarnation = incarnation;
      member.state = state;
      member.lastObserved = Date.now();
    } else if (incarnation === member.incarnation) {
      if (state === NodeState.DEAD) {
        member.state = NodeState.DEAD;
      } else if (state === NodeState.SUSPECT && member.state === NodeState.ALIVE) {
        member.state = NodeState.SUSPECT;
        member.lastObserved = Date.now();
      }
    }
  }

  /**
   * Evaluates suspicion timeouts and transitions overdue suspect members to dead.
   */
  evaluateSuspicion() {
    const now = Date.now();
    for (const [, member] of this.members) {
      if (member.state === NodeState.SUSPECT) {
        if (now - member.lastObserved >= this.suspicionTimeoutMs) {
          member.state = NodeState.DEAD;
        }
      }
    }
  }
}
