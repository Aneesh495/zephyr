/**
 * src/storage/storage_engine.js
 *
 * Root StorageEngine coordinator and topic catalog for Zephyr.
 * Manages partition logs across topics, hash-based key partitioning using MurmurHash3,
 * background retention sweeps, and lifecycle management.
 */

import fs from "node:fs";
import path from "node:path";
import { PartitionLog } from "./partition_log.js";
import { LogCompactor } from "./compactor.js";
import { murmur3_32 } from "../common/murmur3.js";

export class StorageEngine {
  /**
   * @param {object} options
   * @param {string} options.dataDir Root directory for all topics and partitions
   * @param {number} [options.defaultPartitions=4] Default partition count for auto-created topics
   * @param {number} [options.maxSegmentBytes=67108864] Default segment roll size (64MB)
   * @param {number} [options.retentionMs=604800000] Default retention time (7 days)
   * @param {number} [options.compactionIntervalMs=60000] Compaction sweep frequency
   */
  constructor({
    dataDir,
    defaultPartitions = 4,
    maxSegmentBytes = 64 * 1024 * 1024,
    retentionMs = 7 * 24 * 3600 * 1000,
    compactionIntervalMs = 60000,
  }) {
    this.dataDir = path.resolve(dataDir);
    this.defaultPartitions = defaultPartitions;
    this.maxSegmentBytes = maxSegmentBytes;
    this.retentionMs = retentionMs;
    this.compactionIntervalMs = compactionIntervalMs;

    /** @type {Map<string, { partitionCount: number, partitions: Map<number, PartitionLog>, compacted: boolean }>} */
    this.topics = new Map();
    this.compactor = new LogCompactor();
    this.maintenanceTimer = null;
    this.isClosed = false;
  }

  /**
   * Initializes the storage engine, scans existing directory structure, and starts maintenance.
   */
  open() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const entries = fs.readdirSync(this.dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        this._loadExistingTopic(entry.name);
      }
    }

    this.maintenanceTimer = setInterval(() => {
      this._runMaintenance();
    }, this.compactionIntervalMs);
    // Unref timer so node process does not hang on clean exits
    if (this.maintenanceTimer.unref) {
      this.maintenanceTimer.unref();
    }
  }

  _loadExistingTopic(topicName) {
    const topicDir = path.join(this.dataDir, topicName);
    const partDirs = fs.readdirSync(topicDir, { withFileTypes: true });
    const partitionMap = new Map();

    for (const pd of partDirs) {
      if (pd.isDirectory() && pd.name.startsWith("partition-")) {
        const partId = parseInt(pd.name.replace("partition-", ""), 10);
        const pLog = new PartitionLog({
          directory: path.join(topicDir, pd.name),
          topic: topicName,
          partition: partId,
          maxSegmentBytes: this.maxSegmentBytes,
          retentionMs: this.retentionMs,
        });
        pLog.open();
        partitionMap.set(partId, pLog);
      }
    }

    this.topics.set(topicName, {
      partitionCount: partitionMap.size || this.defaultPartitions,
      partitions: partitionMap,
      compacted: false,
    });
  }

  /**
   * Creates a new topic with a specified partition count.
   *
   * @param {string} topic Topic name
   * @param {object} [config]
   * @param {number} [config.partitions] Number of partitions
   * @param {boolean} [config.compacted=false] Whether this topic is a compacted changelog
   */
  createTopic(topic, config = {}) {
    if (this.topics.has(topic)) {
      return this.topics.get(topic);
    }

    const partitionCount = config.partitions || this.defaultPartitions;
    const isCompacted = config.compacted ?? false;
    const topicDir = path.join(this.dataDir, topic);
    const partitionMap = new Map();

    for (let p = 0; p < partitionCount; p++) {
      const partDir = path.join(topicDir, `partition-${p}`);
      const pLog = new PartitionLog({
        directory: partDir,
        topic,
        partition: p,
        maxSegmentBytes: this.maxSegmentBytes,
        retentionMs: this.retentionMs,
      });
      pLog.open();
      partitionMap.set(p, pLog);
    }

    const topicEntry = {
      partitionCount,
      partitions: partitionMap,
      compacted: isCompacted,
    };
    this.topics.set(topic, topicEntry);
    return topicEntry;
  }

  /**
   * Determines the partition for a record using MurmurHash3 on the key.
   *
   * @param {string} topic
   * @param {Buffer|string|null} key
   * @returns {number} Partition index
   */
  getPartitionForKey(topic, key) {
    const topicEntry = this.topics.get(topic) || this.createTopic(topic);
    if (!key) {
      // Round-robin or random distribution for unkeyed records
      return Math.floor(Math.random() * topicEntry.partitionCount);
    }
    const hash = murmur3_32(key);
    return hash % topicEntry.partitionCount;
  }

  /**
   * Appends a record to a topic.
   *
   * @param {string} topic Topic name
   * @param {object} record Record payload
   * @param {number} [explicitPartition] Explicit partition index override
   * @param {boolean} [sync=false] Fsync flag
   * @returns {{ topic: string, partition: number, offset: bigint, timestamp: bigint }}
   */
  append(topic, record, explicitPartition = undefined, sync = false) {
    const topicEntry = this.topics.get(topic) || this.createTopic(topic);
    const partitionId = explicitPartition !== undefined
      ? explicitPartition
      : this.getPartitionForKey(topic, record.key);

    const partitionLog = topicEntry.partitions.get(partitionId);
    if (!partitionLog) {
      throw new Error(`Partition ${partitionId} not found in topic ${topic}`);
    }

    const result = partitionLog.append(record, sync);
    return {
      topic,
      partition: partitionId,
      offset: result.offset,
      timestamp: result.timestamp,
    };
  }

  /**
   * Reads a slice of records from a specific topic and partition.
   *
   * @param {string} topic Topic name
   * @param {number} partition Partition index
   * @param {bigint|number} startOffset Starting offset
   * @param {number} [maxRecords=100] Max records to return
   * @returns {Array<object>}
   */
  read(topic, partition, startOffset, maxRecords = 100) {
    const topicEntry = this.topics.get(topic);
    if (!topicEntry) return [];

    const partitionLog = topicEntry.partitions.get(partition);
    if (!partitionLog) return [];

    return partitionLog.read(startOffset, maxRecords);
  }

  _runMaintenance() {
    for (const [topicName, topicEntry] of this.topics) {
      for (const [, pLog] of topicEntry.partitions) {
        try {
          pLog.enforceRetention();
          if (topicEntry.compacted) {
            this.compactor.compact(pLog);
          }
        } catch {
          // Keep background sweep resilient
        }
      }
    }
  }

  close() {
    if (!this.isClosed) {
      if (this.maintenanceTimer) {
        clearInterval(this.maintenanceTimer);
        this.maintenanceTimer = null;
      }
      for (const [, topicEntry] of this.topics) {
        for (const [, pLog] of topicEntry.partitions) {
          pLog.close();
        }
      }
      this.isClosed = true;
    }
  }
}
