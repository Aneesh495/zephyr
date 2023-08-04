/**
 * src/net/tcp_client.js
 *
 * Multiplexed TCP client for Zephyr with correlation-based request-response matching
 * and 64-byte aligned binary wire framing.
 */

import net from "node:net";
import { encodeFrame, decodeFrame, HEADER_SIZE, RecordType } from "../common/binary_frame.js";

export class TcpClient {
  /**
   * @param {object} [options]
   * @param {string} [options.host="127.0.0.1"]
   * @param {number} [options.port=9092]
   */
  constructor({ host = "127.0.0.1", port = 9092 } = {}) {
    this.host = host;
    this.port = port;
    this.socket = null;
    this.correlationCounter = 1n;
    this.pendingRequests = new Map();
    this.bufferAcc = Buffer.alloc(0);
    this.isConnected = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this.isConnected = true;
        resolve();
      });

      this.socket.on("data", (chunk) => {
        this.bufferAcc = Buffer.concat([this.bufferAcc, chunk]);

        while (this.bufferAcc.length >= HEADER_SIZE) {
          const payloadLen = this.bufferAcc.readUInt32LE(4);
          const unalignedTotal = HEADER_SIZE + payloadLen;
          const paddingBytes = (8 - (unalignedTotal % 8)) % 8;
          const totalFrameSize = unalignedTotal + paddingBytes;

          if (this.bufferAcc.length < totalFrameSize) {
            break;
          }

          const frameBytes = this.bufferAcc.subarray(0, totalFrameSize);
          this.bufferAcc = this.bufferAcc.subarray(totalFrameSize);

          try {
            const frame = decodeFrame(frameBytes);
            const cid = frame.correlationId.toString();
            const pair = this.pendingRequests.get(cid);
            if (pair) {
              this.pendingRequests.delete(cid);
              const json = JSON.parse(frame.value.toString("utf8"));
              pair.resolve(json);
            }
          } catch (err) {
            // Drop corrupt frame or reject matching
          }
        }
      });

      this.socket.on("error", (err) => {
        for (const [, pair] of this.pendingRequests) {
          pair.reject(err);
        }
        this.pendingRequests.clear();
        reject(err);
      });

      this.socket.on("close", () => {
        this.isConnected = false;
      });
    });
  }

  /**
   * Sends a framed RPC request and awaits corresponding response.
   *
   * @param {object} payload
   * @param {Buffer|string|null} [key=null]
   * @returns {Promise<object>}
   */
  sendRpc(payload, key = null) {
    if (!this.isConnected || !this.socket) {
      return Promise.reject(new Error("TCP client not connected"));
    }

    const correlationId = this.correlationCounter++;
    const frame = encodeFrame({
      type: RecordType.RPC_REQUEST,
      correlationId,
      key,
      value: JSON.stringify(payload),
    });

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(correlationId.toString(), { resolve, reject });
      this.socket.write(frame);
    });
  }

  close() {
    return new Promise((resolve) => {
      if (this.socket) {
        this.socket.end(() => {
          this.isConnected = false;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
