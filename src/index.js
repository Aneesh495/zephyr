/**
 * src/index.js
 *
 * Root module entrypoint for Zephyr: High-Throughput Distributed Stream-Relational Engine & CEP Kernel.
 * Exports core storage, stream-relational execution, CEP, consensus, and client SDKs.
 */

export { StorageEngine } from "./storage/storage_engine.js";
export { PartitionLog } from "./storage/partition_log.js";
export { LogSegment } from "./storage/segment.js";
export { SparseIndex } from "./storage/sparse_index.js";
export { LogCompactor } from "./storage/compactor.js";

export { StreamPipeline } from "./stream/pipeline.js";
export { WindowStateManager, TumblingWindowAssigner, SlidingWindowAssigner } from "./stream/window.js";
export { BoundedOutOfOrderWatermarkGenerator, PunctuatedWatermarkGenerator, Watermark } from "./stream/watermark.js";
export { StreamJoinOperator } from "./stream/join.js";
export { MaterializedTable } from "./stream/changelog.js";
export { TDigest } from "./stream/tdigest.js";

export { Pattern } from "./cep/pattern.js";
export { CEPMatcher } from "./cep/matcher.js";

export { RaftNode, RaftRole } from "./cluster/raft_node.js";
export { GossipMembership, NodeState } from "./cluster/gossip.js";
export { RangeAssignor, RoundRobinAssignor, StickyCooperativeAssignor } from "./cluster/partition_assignor.js";
export { ClusterCoordinator } from "./cluster/coordinator.js";

export { SPSCQueue, MPMCQueue } from "./concurrency/ring_buffer.js";
export { SharedMemoryCoordinator } from "./concurrency/shared_memory.js";
export { WorkerPool } from "./concurrency/worker_pool.js";

export { Lexer } from "./sql/lexer.js";
export { Parser } from "./sql/parser.js";
export { QueryOptimizer } from "./sql/optimizer.js";

export { TcpServer } from "./net/tcp_server.js";
export { TcpClient } from "./net/tcp_client.js";
export { HttpServer } from "./net/http_server.js";
export { WebSocketServer } from "./net/ws_server.js";

export { ZephyrClient } from "./client/client.js";
export { ZephyrProducer } from "./client/producer.js";
export { ZephyrConsumer } from "./client/consumer.js";

export { crc32c, crc32cHex } from "./common/crc32c.js";
export { encodeFrame, decodeFrame, RecordType, FrameFlags } from "./common/binary_frame.js";
export { ByteBuffer, BufferPool } from "./common/byte_buffer.js";
export { murmur3_32, murmur3_128 } from "./common/murmur3.js";
export { MonotonicClock, HybridLogicalClock } from "./common/clock.js";
export { MetricRegistry, globalMetrics } from "./common/metrics.js";
