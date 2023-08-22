/**
 * clients/c/zephyr_wire.h
 *
 * C99 wire protocol definitions for the Zephyr 64-byte cache-line aligned frame.
 */

#ifndef ZEPHYR_WIRE_H
#define ZEPHYR_WIRE_H

#include <stdint.h>
#include <stddef.h>

#define ZEPHYR_FRAME_MAGIC 0x5A455048 // "ZEPH" in Little-Endian
#define ZEPHYR_HEADER_SIZE 64

typedef enum {
    ZEPHYR_RECORD_DATA        = 0x0001,
    ZEPHYR_RECORD_WATERMARK   = 0x0002,
    ZEPHYR_RECORD_CHECKPOINT  = 0x0003,
    ZEPHYR_RECORD_TOMBSTONE   = 0x0004,
    ZEPHYR_RECORD_HEARTBEAT   = 0x0005,
    ZEPHYR_RECORD_RPC_REQUEST = 0x0006,
    ZEPHYR_RECORD_RPC_RESPONSE= 0x0007
} zephyr_record_type_t;

#pragma pack(push, 1)
typedef struct {
    uint32_t magic;           // [00..03]
    uint32_t payload_len;     // [04..07]
    uint32_t checksum;        // [08..11] Castagnoli CRC32C
    uint16_t type;            // [12..13]
    uint16_t flags;           // [14..15]
    uint64_t offset;          // [16..23]
    int64_t  timestamp;       // [24..31]
    uint32_t key_len;         // [32..35]
    uint32_t meta_len;        // [36..39]
    uint64_t correlation_id;  // [40..47]
    uint8_t  reserved[16];    // [48..63]
} zephyr_header_t;
#pragma pack(pop)

uint32_t zephyr_crc32c(const uint8_t *data, size_t length, uint32_t initial);
size_t zephyr_encode_frame(uint8_t *out_buffer,
                           zephyr_record_type_t type,
                           uint64_t offset,
                           int64_t timestamp,
                           uint64_t correlation_id,
                           const uint8_t *key, size_t key_len,
                           const uint8_t *value, size_t value_len);

#endif // ZEPHYR_WIRE_H
