/**
 * src/net/ws_server.js
 *
 * RFC 6455 compliant pure JavaScript WebSocket pub/sub streaming server.
 * Implements cryptographic handshake, frame masking/unmasking, and
 * real-time event broadcasting to subscribed dashboard clients and consumers.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const WS_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.subscriptions = new Set();

    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this._parseFrames();
    });

    this.socket.on("close", () => {
      this.emit("close");
    });

    this.socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  _parseFrames() {
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0];
      const b1 = this.buffer[1];

      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0F;
      const masked = (b1 & 0x80) !== 0;
      let payloadLength = b1 & 0x7F;

      let currentOffset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < 4) return;
        payloadLength = this.buffer.readUInt16BE(2);
        currentOffset = 4;
      } else if (payloadLength === 127) {
        if (this.buffer.length < 10) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(2));
        currentOffset = 10;
      }

      let maskKey = null;
      if (masked) {
        if (this.buffer.length < currentOffset + 4) return;
        maskKey = this.buffer.subarray(currentOffset, currentOffset + 4);
        currentOffset += 4;
      }

      if (this.buffer.length < currentOffset + payloadLength) return;

      const payload = this.buffer.subarray(currentOffset, currentOffset + payloadLength);
      this.buffer = this.buffer.subarray(currentOffset + payloadLength);

      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x1) {
        // Text frame
        const text = payload.toString("utf8");
        this.emit("text", text);
      } else if (opcode === 0x8) {
        // Close frame
        this.socket.end();
      } else if (opcode === 0x9) {
        // Ping frame: reply with Pong
        this.sendFrame(payload, 0xA);
      }
    }
  }

  send(data) {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    this.sendFrame(Buffer.from(text, "utf8"), 0x1);
  }

  sendFrame(payload, opcode = 0x1) {
    const len = payload.length;
    let header;

    if (len <= 125) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | (opcode & 0x0F);
      header[1] = len;
    } else if (len <= 65535) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | (opcode & 0x0F);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | (opcode & 0x0F);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    if (this.socket.writable) {
      this.socket.write(Buffer.concat([header, payload]));
    }
  }
}

export class WebSocketServer extends EventEmitter {
  /**
   * @param {import('node:http').Server} httpServer
   */
  constructor(httpServer) {
    super();
    this.httpServer = httpServer;
    this.clients = new Set();
    /** @type {Map<string, Set<WebSocketConnection>>} */
    this.topicSubscribers = new Map();

    this.httpServer.on("upgrade", (req, socket) => {
      this._handleUpgrade(req, socket);
    });
  }

  _handleUpgrade(req, socket) {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash("sha1")
      .update(key + WS_MAGIC_STRING)
      .digest("base64");

    const responseHeaders = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n",
    ];

    socket.write(responseHeaders.join("\r\n"));

    const client = new WebSocketConnection(socket);
    this.clients.add(client);
    this.emit("connection", client);

    client.on("text", (text) => {
      try {
        const msg = JSON.parse(text);
        if (msg.action === "SUBSCRIBE" && msg.topic) {
          let set = this.topicSubscribers.get(msg.topic);
          if (!set) {
            set = new Set();
            this.topicSubscribers.set(msg.topic, set);
          }
          set.add(client);
          client.subscriptions.add(msg.topic);
          client.send({ status: "SUBSCRIBED", topic: msg.topic });
        }
      } catch {
        // Ignore unformatted json
      }
    });

    client.on("close", () => {
      this.clients.delete(client);
      for (const topic of client.subscriptions) {
        const set = this.topicSubscribers.get(topic);
        if (set) set.delete(client);
      }
    });
  }

  /**
   * Broadcasts a stream event to all active clients subscribed to the topic.
   *
   * @param {string} topic
   * @param {object} event
   */
  publish(topic, event) {
    const set = this.topicSubscribers.get(topic);
    if (!set) return;

    const payload = JSON.stringify({
      topic,
      event,
      timestamp: Date.now(),
    });

    for (const client of set) {
      client.send(payload);
    }
  }

  /**
   * Broadcasts telemetry metrics to all connected clients.
   *
   * @param {object} metrics
   */
  broadcastMetrics(metrics) {
    const payload = JSON.stringify({ type: "METRICS_UPDATE", data: metrics });
    for (const client of this.clients) {
      client.send(payload);
    }
  }
}
