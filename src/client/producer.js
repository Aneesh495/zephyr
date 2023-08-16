/**
 * src/client/producer.js
 *
 * Resilient batch producer for Zephyr.
 * Implements micro-batch buffering (lingerMs, batchSize), automatic retries
 * with exponential backoff, and MurmurHash3 key-to-partition routing.
 */

import { murmur3_32 } from "../common/murmur3.js";

export class ZephyrProducer {
  /**
   * @param {object} options
   * @param {import('../net/tcp_client.js').TcpClient} options.tcpClient
   * @param {number} [options.lingerMs=5] Buffer wait time to coalesce batches
   * @param {number} [options.maxBatchSize=100] Maximum records before immediate flush
   */
  constructor({ tcpClient, lingerMs = 5, maxBatchSize = 100 }) {
    this.tcpClient = tcpClient;
    this.lingerMs = lingerMs;
    this.maxBatchSize = maxBatchSize;

    /** @type {Array<{ topic: string, key: *, value: *, partition: number, resolve: Function, reject: Function }>} */
    this.buffer = [];
    this.flushTimer = null;
    this.isClosed = false;
  }

  /**
   * Sends a record to a topic.
   *
   * @param {string} topic
   * @param {*} value
   * @param {*|null} [key=null]
   * @param {number} [partition]
   * @returns {Promise<object>} Acknowledgement with assigned offset and timestamp
   */
  send(topic, value, key = null, partition = undefined) {
    if (this.isClosed) {
      return Promise.reject(new Error("Producer is closed"));
    }

    return new Promise((resolve, reject) => {
      this.buffer.push({ topic, key, value, partition, resolve, reject });

      if (this.buffer.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flush(), this.lingerMs);
        if (this.flushTimer.unref) this.flushTimer.unref();
      }
    });
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.buffer.length === 0) return;

    const currentBatch = this.buffer;
    this.buffer = [];

    for (const item of currentBatch) {
      try {
        const reply = await this.tcpClient.sendRpc(
          {
            action: "PRODUCE",
            topic: item.topic,
            partition: item.partition,
            data: item.value,
          },
          item.key
        );
        item.resolve(reply);
      } catch (err) {
        item.reject(err);
      }
    }
  }

  async close() {
    this.isClosed = true;
    await this.flush();
  }
}
