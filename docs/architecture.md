# Zephyr System Architecture & Topography

Zephyr is a distributed stream-relational engine and complex event processing (CEP) kernel designed from first principles in modern ECMAScript. It unifies low-latency partitioned append-only log storage, SQL-based streaming relational transformations, event-time watermarking, and non-deterministic finite automaton (NFA-e) pattern recognition into a cohesive, zero-dependency runtime.

---

## Architectural Topography

```
                                    +-------------------------------------------------------------+
                                    |                        Zephyr Gateway                       |
                                    |   - HTTP/1.1 REST API (Ingest, Query, Subscriptions)       |
                                    |   - WebSocket Pub/Sub Stream Multiplexer                   |
                                    |   - Binary TCP Wire Protocol (Framed RPC, Zero-Copy)       |
                                    +-------------------------------------------------------------+
                                                                  |
                                    +-------------------------------------------------------------+
                                    |                 Stream-SQL & Query Engine                   |
                                    |   - Lexer & Recursive-Descent Stream-SQL Parser             |
                                    |   - AST Optimizer, Projection, Filter Pushdown              |
                                    |   - Stream-Table Duality Engine (Changelog <-> Materialized)|
                                    +-------------------------------------------------------------+
                                                                  |
                    +---------------------------------------------+---------------------------------------------+
                    |                                                                                           |
+-----------------------------------------------+                                           +-----------------------------------------------+
|         Windowing & State Aggregator          |                                           |          Complex Event Processor (CEP)        |
|  - Watermark-driven Event Time Engine         |                                           |  - NFA-e (Non-deterministic Finite Automaton) |
|  - Tumbling, Sliding, Hopping, Session Windows|                                           |  - Declarative Pattern: PATTERN (A B+ C)      |
|  - Stateful Stream-to-Stream Equi-Joins       |                                           |  - Temporal Constraints (WITHIN delta-t)      |
|  - Online Percentiles via T-Digest Algorithm  |                                           |  - Contiguity Modes: STRICT, RELAXED, SKIP    |
+-----------------------------------------------+                                           +-----------------------------------------------+
                    |                                                                                           |
                    +---------------------------------------------+---------------------------------------------+
                                                                  |
                                    +-------------------------------------------------------------+
                                    |           Concurrent Worker Pool & Ring Buffers             |
                                    |   - Worker Threads executing streaming stages in parallel  |
                                    |   - SharedArrayBuffer with Atomics memory barriers          |
                                    |   - Lock-Free SPSC & MPMC Disruptor Ring Buffers            |
                                    +-------------------------------------------------------------+
                                                                  |
                    +---------------------------------------------+---------------------------------------------+
                    |                                                                                           |
+-----------------------------------------------+                                           +-----------------------------------------------+
|             Log Storage Engine (WAL)          |                                           |          Cluster Consensus & Topology         |
|  - Topic/Partition Append-Only Segment Logs   |                                           |  - Pure Raft Consensus State Machine          |
|  - Castagnoli CRC32C Frame Integrity Checksum |                                           |  - Leader Election, Heartbeats, Log Append    |
|  - Sparse Radix Index (Offset & Timestamp)    |                                           |  - Partition Assignors: Range, RoundRobin,    |
|  - Memory-Mapped / Block Allocation Buffers   |                                           |    Cooperative Sticky Rebalance               |
|  - Compaction & Tombstone Log Cleaner         |                                           |  - Gossip-Based Cluster Health Heartbeat      |
+-----------------------------------------------+                                           +-----------------------------------------------+
```

---

## Core Engineering Subsystems

### 1. Zero-Copy 64-Byte Aligned Binary Framing
Every record stored on disk or transmitted across network sockets conforms to a cache-line aligned (64-byte) binary frame header:
- Magic identification bytes: `0x5A455048` ("ZEPH")
- Castagnoli CRC32C checksum using the `0x82F63B78` polynomial over header fields and payload
- Fixed offsets for sequence counters, timestamps, partition keys, metadata, and correlation IDs
- Padding to hardware word boundaries (8-byte multiples)

### 2. Lock-Free Concurrency & Shared Memory
Zephyr eliminates garbage collection pauses in hot streaming paths using lock-free ring buffers:
- **SPSC Queue**: Cache-line separated head and tail index arrays preventing false sharing on multi-core processors.
- **MPMC Queue**: Dmitry Vyukov bounded lock-free ring buffer algorithm with cell sequence verification and atomic compare-and-swap primitives.
- **SharedArrayBuffer Memory Coordinator**: Allocates fixed-size slabs for inter-worker data exchange without structured-clone serialization overhead.

### 3. Stream-Relational Execution & Stream-Table Duality
Stream queries compile through a recursive-descent parser into an Abstract Syntax Tree (AST) optimized with constant folding, projection pruning, and predicate pushdown. The engine maintains dynamic materialized tables as snapshots of changelog event streams.

### 4. NFA-e Complex Event Processing
Pattern recognition is powered by an epsilon-transition Non-deterministic Finite Automaton (NFA-e). Patterns support strict contiguity (`next`), relaxed contiguity (`followedBy`), and Kleene plus (`oneOrMore`) within temporal deadlines.

### 5. Raft Distributed Consensus & Cooperative Rebalance
Cluster topology and leader election operate under the Raft consensus algorithm. Consumer partition assignment supports Range, RoundRobin, and Sticky Cooperative assignors (minimizing partition movement during node churn).
