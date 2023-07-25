/**
 * src/cluster/rpc_transport.js
 *
 * Peer-to-peer RPC transport abstraction for Raft message passing.
 * Provides in-memory loopback routing for testing and cluster simulation.
 */

export class MockRaftTransport {
  constructor() {
    /** @type {Map<string, import('./raft_node.js').RaftNode>} */
    this.nodes = new Map();
  }

  registerNode(node) {
    this.nodes.set(node.id, node);
    node.setTransport(this);
  }

  async sendRequestVote(peerId, request) {
    const peer = this.nodes.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found`);
    return peer.handleRequestVote(request);
  }

  async sendAppendEntries(peerId, request) {
    const peer = this.nodes.get(peerId);
    if (!peer) throw new Error(`Peer ${peerId} not found`);
    return peer.handleAppendEntries(request);
  }
}
