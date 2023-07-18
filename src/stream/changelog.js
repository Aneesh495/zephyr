/**
 * src/stream/changelog.js
 *
 * Stream-Table duality engine: materializes changelog streams into indexed key-value
 * tables with point-in-time lookup, versioned mutations, and tombstone handling.
 */

export class MaterializedTable {
  /**
   * @param {string} name Table identifier
   */
  constructor(name) {
    this.name = name;
    /** @type {Map<string, { value: *, offset: bigint, timestamp: bigint, version: number }>} */
    this.state = new Map();
    this.mutationListeners = [];
  }

  /**
   * Applies an incoming changelog event to materialize table state.
   *
   * @param {object} event Stream event
   * @returns {{ op: "INSERT"|"UPDATE"|"DELETE", key: string, prev: *|null, current: *|null }}
   */
  applyEvent(event) {
    const key = event.key?.toString("utf8") ?? String(event.key);
    const existing = this.state.get(key);
    const offset = BigInt(event.offset ?? 0);
    const timestamp = BigInt(event.timestamp ?? Date.now());

    // Check if tombstone
    const isTombstone = event.value == null || event.value.length === 0 || event.flags === 1;

    let op = "INSERT";
    let prev = existing ? existing.value : null;

    if (isTombstone) {
      if (existing) {
        op = "DELETE";
        this.state.delete(key);
      } else {
        return null; // Redundant tombstone
      }
    } else {
      if (existing) {
        op = "UPDATE";
      }
      this.state.set(key, {
        value: event.value,
        offset,
        timestamp,
        version: existing ? existing.version + 1 : 1,
      });
    }

    const mutation = {
      op,
      key,
      prev,
      current: isTombstone ? null : event.value,
      offset,
      timestamp,
    };

    for (const listener of this.mutationListeners) {
      listener(mutation);
    }

    return mutation;
  }

  get(key) {
    const entry = this.state.get(String(key));
    return entry ? entry.value : null;
  }

  has(key) {
    return this.state.has(String(key));
  }

  size() {
    return this.state.size;
  }

  entries() {
    return this.state.entries();
  }

  onMutation(listener) {
    this.mutationListeners.push(listener);
  }
}
