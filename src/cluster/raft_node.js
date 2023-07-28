/**
 * src/cluster/raft_node.js
 *
 * Raft distributed consensus state machine implementing leader election,
 * heartbeat heartbeats, and committed entry application.
 */

import { EventEmitter } from "node:events";
import { RaftLog } from "./raft_log.js";

export const RaftRole = Object.freeze({
  FOLLOWER: "FOLLOWER",
  CANDIDATE: "CANDIDATE",
  LEADER: "LEADER",
});

export class RaftNode extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.id Unique node identifier
   * @param {Array<string>} options.peers List of peer node IDs
   * @param {number} [options.minElectionTimeoutMs=150]
   * @param {number} [options.maxElectionTimeoutMs=300]
   * @param {number} [options.heartbeatIntervalMs=50]
   */
  constructor({
    id,
    peers = [],
    minElectionTimeoutMs = 150,
    maxElectionTimeoutMs = 300,
    heartbeatIntervalMs = 50,
  }) {
    super();
    this.id = id;
    this.peers = peers;
    this.minElectionTimeoutMs = minElectionTimeoutMs;
    this.maxElectionTimeoutMs = maxElectionTimeoutMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;

    this.role = RaftRole.FOLLOWER;
    this.currentTerm = 0;
    this.votedFor = null;
    this.log = new RaftLog();

    this.commitIndex = 0;
    this.lastApplied = 0;

    // Leader state
    this.nextIndex = new Map();
    this.matchIndex = new Map();

    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.transport = null;
    this.stateMachine = [];
  }

  setTransport(transport) {
    this.transport = transport;
  }

  start() {
    this._resetElectionTimeout();
  }

  _randomElectionTimeout() {
    const range = this.maxElectionTimeoutMs - this.minElectionTimeoutMs;
    return this.minElectionTimeoutMs + Math.floor(Math.random() * range);
  }

  _resetElectionTimeout() {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
    this.electionTimer = setTimeout(() => {
      this._startElection();
    }, this._randomElectionTimeout());

    if (this.electionTimer.unref) {
      this.electionTimer.unref();
    }
  }

  _startElection() {
    this.role = RaftRole.CANDIDATE;
    this.currentTerm += 1;
    this.votedFor = this.id;
    let votesReceived = 1; // Vote for self

    this._resetElectionTimeout();

    const lastLogIndex = this.log.lastIndex;
    const lastLogTerm = this.log.lastTerm;
    const term = this.currentTerm;

    for (const peer of this.peers) {
      if (!this.transport) continue;

      this.transport.sendRequestVote(peer, {
        term,
        candidateId: this.id,
        lastLogIndex,
        lastLogTerm,
      }).then((reply) => {
        if (!reply || this.role !== RaftRole.CANDIDATE || this.currentTerm !== term) {
          return;
        }

        if (reply.term > this.currentTerm) {
          this._stepDown(reply.term);
          return;
        }

        if (reply.voteGranted) {
          votesReceived++;
          const quorum = Math.floor((this.peers.length + 1) / 2) + 1;
          if (votesReceived >= quorum) {
            this._becomeLeader();
          }
        }
      }).catch(() => {
        // Peer unreachable, ignore
      });
    }
  }

  _becomeLeader() {
    this.role = RaftRole.LEADER;
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    for (const peer of this.peers) {
      this.nextIndex.set(peer, this.log.lastIndex + 1);
      this.matchIndex.set(peer, 0);
    }

    this.emit("leader_elected", { term: this.currentTerm, leaderId: this.id });
    this._sendAppendEntriesToAll();

    this.heartbeatTimer = setInterval(() => {
      this._sendAppendEntriesToAll();
    }, this.heartbeatIntervalMs);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  _stepDown(term) {
    this.role = RaftRole.FOLLOWER;
    this.currentTerm = term;
    this.votedFor = null;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this._resetElectionTimeout();
    this.emit("step_down", { term });
  }

  _sendAppendEntriesToAll() {
    if (this.role !== RaftRole.LEADER) return;

    for (const peer of this.peers) {
      const prevLogIndex = (this.nextIndex.get(peer) || 1) - 1;
      const prevLogTerm = this.log.getTerm(prevLogIndex);
      const entries = this.log.getEntriesFrom(prevLogIndex + 1);

      if (!this.transport) continue;

      this.transport.sendAppendEntries(peer, {
        term: this.currentTerm,
        leaderId: this.id,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.commitIndex,
      }).then((reply) => {
        if (!reply || this.role !== RaftRole.LEADER) return;

        if (reply.term > this.currentTerm) {
          this._stepDown(reply.term);
          return;
        }

        if (reply.success) {
          const match = prevLogIndex + entries.length;
          this.matchIndex.set(peer, match);
          this.nextIndex.set(peer, match + 1);
          this._checkCommitIndex();
        } else {
          // Decrement nextIndex and retry
          const curNext = this.nextIndex.get(peer) || 1;
          this.nextIndex.set(peer, Math.max(1, curNext - 1));
        }
      }).catch(() => {
        // Peer unreachable
      });
    }
  }

  _checkCommitIndex() {
    // If there exists an N > commitIndex, a majority of matchIndex[i] >= N,
    // and log[N].term == currentTerm: set commitIndex = N
    for (let N = this.log.lastIndex; N > this.commitIndex; N--) {
      if (this.log.getTerm(N) !== this.currentTerm) continue;

      let matchCount = 1; // Leader matches its own log
      for (const peer of this.peers) {
        if ((this.matchIndex.get(peer) || 0) >= N) {
          matchCount++;
        }
      }

      const quorum = Math.floor((this.peers.length + 1) / 2) + 1;
      if (matchCount >= quorum) {
        this.commitIndex = N;
        this._applyEntries();
        break;
      }
    }
  }

  _applyEntries() {
    while (this.commitIndex > this.lastApplied) {
      this.lastApplied++;
      const entry = this.log.getEntry(this.lastApplied);
      if (entry) {
        this.stateMachine.push(entry.command);
        this.emit("entry_applied", entry);
      }
    }
  }

  handleRequestVote(request) {
    const { term, candidateId, lastLogIndex, lastLogTerm } = request;

    if (term > this.currentTerm) {
      this._stepDown(term);
    }

    let voteGranted = false;
    if (term === this.currentTerm && (this.votedFor === null || this.votedFor === candidateId)) {
      // Check candidate log completeness
      const myLastTerm = this.log.lastTerm;
      const myLastIndex = this.log.lastIndex;

      const isCandidateUpToDate =
        lastLogTerm > myLastTerm ||
        (lastLogTerm === myLastTerm && lastLogIndex >= myLastIndex);

      if (isCandidateUpToDate) {
        voteGranted = true;
        this.votedFor = candidateId;
        this._resetElectionTimeout();
      }
    }

    return {
      term: this.currentTerm,
      voteGranted,
    };
  }

  handleAppendEntries(request) {
    const { term, prevLogIndex, prevLogTerm, entries, leaderCommit } = request;

    if (term > this.currentTerm) {
      this._stepDown(term);
    }

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    // Valid leader heartbeat: reset election timeout
    this._resetElectionTimeout();

    const success = this.log.replicate(prevLogIndex, prevLogTerm, entries);
    if (success) {
      if (leaderCommit > this.commitIndex) {
        this.commitIndex = Math.min(leaderCommit, this.log.lastIndex);
        this._applyEntries();
      }
    }

    return {
      term: this.currentTerm,
      success,
    };
  }

  close() {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
