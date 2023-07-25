/**
 * src/cluster/raft_log.js
 *
 * In-memory and WAL-compatible Raft consensus log journal.
 * Implements strict term/index log matching and committed entry application.
 */

export class LogEntry {
  /**
   * @param {number} term Raft term when entry was received
   * @param {number} index Monotonic log index (1-based)
   * @param {object} command State machine payload
   */
  constructor(term, index, command) {
    this.term = term;
    this.index = index;
    this.command = command;
  }
}

export class RaftLog {
  constructor() {
    /** @type {Array<LogEntry>} */
    this.entries = []; // 0-indexed internally, index 1 corresponds to entries[0]
  }

  get lastIndex() {
    return this.entries.length;
  }

  get lastTerm() {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1].term : 0;
  }

  getEntry(index) {
    if (index < 1 || index > this.entries.length) return null;
    return this.entries[index - 1];
  }

  getTerm(index) {
    if (index === 0) return 0;
    const entry = this.getEntry(index);
    return entry ? entry.term : 0;
  }

  append(term, command) {
    const index = this.entries.length + 1;
    const entry = new LogEntry(term, index, command);
    this.entries.push(entry);
    return entry;
  }

  /**
   * Replicates entries from leader according to Raft log matching rules.
   *
   * @param {number} prevLogIndex
   * @param {number} prevLogTerm
   * @param {Array<LogEntry>} newEntries
   * @returns {boolean} True if consistency check succeeded and entries appended
   */
  replicate(prevLogIndex, prevLogTerm, newEntries) {
    // 1. Reply false if log doesn't contain an entry at prevLogIndex matching prevLogTerm
    if (prevLogIndex > 0) {
      if (prevLogIndex > this.entries.length) {
        return false;
      }
      if (this.entries[prevLogIndex - 1].term !== prevLogTerm) {
        return false;
      }
    }

    // 2. If an existing entry conflicts with a new one, delete existing entry and all that follow it
    let insertIdx = prevLogIndex;
    for (const entry of newEntries) {
      if (insertIdx < this.entries.length) {
        if (this.entries[insertIdx].term !== entry.term) {
          this.entries.length = insertIdx; // Truncate conflicting entries
          this.entries.push(entry);
        }
      } else {
        this.entries.push(entry);
      }
      insertIdx++;
    }

    return true;
  }

  getEntriesFrom(startIndex) {
    if (startIndex > this.entries.length) return [];
    return this.entries.slice(Math.max(0, startIndex - 1));
  }
}
