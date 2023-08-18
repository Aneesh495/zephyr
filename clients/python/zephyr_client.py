"""
clients/python/zephyr_client.py

Zero-dependency Python 3 client SDK for Zephyr.
Implements the 64-byte aligned binary wire framing protocol with CRC32C integrity,
multiplexed RPC, and streaming generators.
"""

import socket
import struct
import json
import time

FRAME_MAGIC = 0x5A455048  # "ZEPH"
HEADER_SIZE = 64

RECORD_TYPE_RPC_REQUEST = 0x0006
RECORD_TYPE_RPC_RESPONSE = 0x0007

# Castagnoli CRC32C table precomputation (reversed poly 0x82F63B78)
CRC32C_TABLE = []
for i in range(256):
    crc = i
    for _ in range(8):
        crc = (crc >> 1) ^ (0x82F63B78 if (crc & 1) else 0)
    CRC32C_TABLE.append(crc & 0xFFFFFFFF)


def crc32c(data: bytes, initial: int = 0) -> int:
    crc = (initial ^ 0xFFFFFFFF) & 0xFFFFFFFF
    for b in data:
        crc = CRC32C_TABLE[(crc ^ b) & 0xFF] ^ (crc >> 8)
    return (crc ^ 0xFFFFFFFF) & 0xFFFFFFFF


class ZephyrClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 9092):
        self.host = host
        self.port = port
        self.sock = None
        self.correlation_id = 1

    def connect(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect((self.host, self.port))
        return self

    def _send_rpc(self, payload: dict, key: str | None = None) -> dict:
        cid = self.correlation_id
        self.correlation_id += 1

        key_bytes = key.encode("utf-8") if key else b""
        meta_bytes = b""
        val_bytes = json.dumps(payload).encode("utf-8")

        payload_len = len(key_bytes) + len(meta_bytes) + len(val_bytes)
        unaligned_total = HEADER_SIZE + payload_len
        padding_bytes = (8 - (unaligned_total % 8)) % 8
        total_frame_size = unaligned_total + padding_bytes

        # Header fields:
        # [00..03] Magic (uint32)
        # [04..07] Payload Length (uint32)
        # [08..11] CRC32C (uint32 placeholder)
        # [12..13] Type (uint16)
        # [14..15] Flags (uint16)
        # [16..23] Offset (uint64)
        # [24..31] Timestamp (int64)
        # [32..35] Key Length (uint32)
        # [36..39] Meta Length (uint32)
        # [40..47] Correlation ID (uint64)
        # [48..63] Reserved (16 bytes)
        now_ts = int(time.time() * 1000)

        header_prefix = struct.pack("<II", FRAME_MAGIC, payload_len)
        header_body = struct.pack(
            "<HHQqIIQ16s",
            RECORD_TYPE_RPC_REQUEST,
            0,
            0,
            now_ts,
            len(key_bytes),
            len(meta_bytes),
            cid,
            b"\x00" * 16,
        )

        full_payload = key_bytes + meta_bytes + val_bytes
        frame_checksum = crc32c(header_body + full_payload)

        full_frame = (
            header_prefix
            + struct.pack("<I", frame_checksum)
            + header_body
            + full_payload
            + (b"\x00" * padding_bytes)
        )

        self.sock.sendall(full_frame)

        # Read response
        header_bytes = self._read_exact(HEADER_SIZE)
        resp_magic, resp_payload_len, resp_crc = struct.unpack("<III", header_bytes[:12])
        if resp_magic != FRAME_MAGIC:
            raise ValueError(f"Invalid frame magic: {hex(resp_magic)}")

        resp_unaligned = HEADER_SIZE + resp_payload_len
        resp_padding = (8 - (resp_unaligned % 8)) % 8
        resp_total = resp_unaligned + resp_padding

        remaining_body = self._read_exact(resp_total - HEADER_SIZE)
        payload_data = remaining_body[:resp_payload_len]

        resp_key_len, resp_meta_len = struct.unpack("<II", header_bytes[32:40])
        val_data = payload_data[resp_key_len + resp_meta_len:]
        return json.loads(val_data.decode("utf-8"))

    def _read_exact(self, num_bytes: int) -> bytes:
        chunks = []
        bytes_recd = 0
        while bytes_recd < num_bytes:
            chunk = self.sock.recv(num_bytes - bytes_recd)
            if not chunk:
                raise ConnectionError("Socket closed prematurely")
            chunks.append(chunk)
            bytes_recd += len(chunk)
        return b"".join(chunks)

    def produce(self, topic: str, value: dict | str, key: str | None = None, partition: int | None = None) -> dict:
        payload = {
            "action": "PRODUCE",
            "topic": topic,
            "partition": partition,
            "data": value,
        }
        return self._send_rpc(payload, key)

    def fetch(self, topic: str, partition: int = 0, offset: int = 0, max_records: int = 50) -> list:
        payload = {
            "action": "FETCH",
            "topic": topic,
            "partition": partition,
            "offset": str(offset),
            "maxRecords": max_records,
        }
        reply = self._send_rpc(payload)
        return reply.get("records", [])

    def stream(self, topic: str, partition: int = 0, poll_interval: float = 0.05):
        offset = 0
        while True:
            records = self.fetch(topic, partition, offset)
            if not records:
                time.sleep(poll_interval)
                continue
            for r in records:
                yield r
                offset = int(r["offset"]) + 1

    def close(self):
        if self.sock:
            self.sock.close()
            self.sock = None
