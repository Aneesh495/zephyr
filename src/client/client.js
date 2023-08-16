/**
 * src/client/client.js
 *
 * Unified Zephyr client facade creating connected producers and consumers.
 */

import { TcpClient } from "../net/tcp_client.js";
import { ZephyrProducer } from "./producer.js";
import { ZephyrConsumer } from "./consumer.js";

export class ZephyrClient {
  /**
   * @param {object} [options]
   * @param {string} [options.host="127.0.0.1"]
   * @param {number} [options.port=9092]
   */
  constructor({ host = "127.0.0.1", port = 9092 } = {}) {
    this.host = host;
    this.port = port;
    this.tcpClient = new TcpClient({ host, port });
  }

  async connect() {
    await this.tcpClient.connect();
    return this;
  }

  producer(options = {}) {
    return new ZephyrProducer({ tcpClient: this.tcpClient, ...options });
  }

  consumer(topic, options = {}) {
    return new ZephyrConsumer({ tcpClient: this.tcpClient, topic, ...options });
  }

  async close() {
    await this.tcpClient.close();
  }
}
