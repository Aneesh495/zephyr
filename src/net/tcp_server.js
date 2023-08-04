/**
 * src/net/tcp_server.js
 *
 * High-throughput binary framed TCP server for Zephyr.
 * Receives framed RPC requests, dispatches writes to StorageEngine,
 * and streams back batches over persistent TCP sockets with zero memory copy.
 */

import net from "node:net";
import { encodeFrame, decodeFrame, HEADER_SIZE, RecordType } from "../common/binary_frame.js";

export class TcpServer {
  /**
   * @param {object} options
   * @param {import('../storage/storage_engine.js').StorageEngine} options.storageEngine
   * @param {number} [options.port=9092]
   * @param {string} [options.host="127.0.0.1"]
   */
  constructor({ storageEngine, port = 9092, host = "127.0.0.1" }) {
    this.storageEngine = storageEngine;
    this.port = port;
    this.host = host;
    this.server = null;
    this.activeSockets = new Set();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.activeSockets.add(socket);
        let bufferAcc = Buffer.alloc(0);

        socket.on("data", (chunk) => {
          bufferAcc = Buffer.concat([bufferAcc, chunk]);

          while (bufferAcc.length >= HEADER_SIZE) {
            const payloadLen = bufferAcc.readUInt32LE(4);
            const unalignedTotal = HEADER_SIZE + payloadLen;
            const paddingBytes = (8 - (unalignedTotal % 8)) % 8;
            const totalFrameSize = unalignedTotal + paddingBytes;

            if (bufferAcc.length < totalFrameSize) {
              break; // Wait for full frame to arrive
            }

            const frameBytes = bufferAcc.subarray(0, totalFrameSize);
            bufferAcc = bufferAcc.subarray(totalFrameSize);

            try {
              const req = decodeFrame(frameBytes);
              this._handleFrame(socket, req);
            } catch (err) {
              const errorReply = encodeFrame({
                type: RecordType.RPC_RESPONSE,
                correlationId: 0n,
                value: JSON.stringify({ error: err.message }),
              });
              socket.write(errorReply);
            }
          }
        });

        socket.on("close", () => {
          this.activeSockets.delete(socket);
        });

        socket.on("error", () => {
          this.activeSockets.delete(socket);
        });
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  _handleFrame(socket, req) {
    if (req.type === RecordType.RPC_REQUEST) {
      let payload = {};
      try {
        payload = JSON.parse(req.value.toString("utf8"));
      } catch {
        payload = {};
      }

      const { action, topic, partition, offset, maxRecords } = payload;

      if (action === "PRODUCE") {
        const key = req.key.length > 0 ? req.key : null;
        const val = payload.data ? JSON.stringify(payload.data) : req.metadata;
        const result = this.storageEngine.append(topic, {
          key,
          value: val,
        }, partition);

        const reply = encodeFrame({
          type: RecordType.RPC_RESPONSE,
          correlationId: req.correlationId,
          value: JSON.stringify({
            status: "OK",
            topic: result.topic,
            partition: result.partition,
            offset: result.offset.toString(),
            timestamp: result.timestamp.toString(),
          }),
        });
        socket.write(reply);
      } else if (action === "FETCH") {
        const records = this.storageEngine.read(topic, partition ?? 0, BigInt(offset ?? 0), maxRecords ?? 50);
        const serialized = records.map((r) => ({
          offset: r.offset.toString(),
          timestamp: r.timestamp.toString(),
          key: r.key.toString("utf8"),
          value: r.value.toString("utf8"),
        }));

        const reply = encodeFrame({
          type: RecordType.RPC_RESPONSE,
          correlationId: req.correlationId,
          value: JSON.stringify({
            status: "OK",
            records: serialized,
          }),
        });
        socket.write(reply);
      }
    }
  }

  close() {
    return new Promise((resolve) => {
      for (const s of this.activeSockets) {
        s.destroy();
      }
      this.activeSockets.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
