/**
 * src/client/consumer.js
 *
 * Streaming consumer for Zephyr with partition offset tracking,
 * polling loops, and async generator stream iteration.
 */

export class ZephyrConsumer {
  /**
   * @param {object} options
   * @param {import('../net/tcp_client.js').TcpClient} options.tcpClient
   * @param {string} options.topic
   * @param {number} [options.partition=0]
   * @param {number} [options.pollIntervalMs=50]
   */
  constructor({ tcpClient, topic, partition = 0, pollIntervalMs = 50 }) {
    this.tcpClient = tcpClient;
    this.topic = topic;
    this.partition = partition;
    this.pollIntervalMs = pollIntervalMs;

    this.currentOffset = 0n;
    this.isPolling = false;
    this.isClosed = false;
  }

  /**
   * Fetches the next batch of records from the current offset.
   *
   * @param {number} [maxRecords=50]
   * @returns {Promise<Array<object>>}
   */
  async poll(maxRecords = 50) {
    if (this.isClosed) return [];

    const reply = await this.tcpClient.sendRpc({
      action: "FETCH",
      topic: this.topic,
      partition: this.partition,
      offset: this.currentOffset.toString(),
      maxRecords,
    });

    if (reply.status === "OK" && Array.isArray(reply.records)) {
      if (reply.records.length > 0) {
        const last = reply.records[reply.records.length - 1];
        this.currentOffset = BigInt(last.offset) + 1n;
      }
      return reply.records;
    }

    return [];
  }

  /**
   * Async generator providing continuous stream iteration over incoming records.
   */
  async *stream() {
    while (!this.isClosed) {
      const records = await this.poll();
      if (records.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      } else {
        for (const record of records) {
          yield record;
        }
      }
    }
  }

  close() {
    this.isClosed = true;
  }
}
