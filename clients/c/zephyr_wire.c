/**
 * clients/c/zephyr_wire.c
 *
 * Implementation of Zephyr 64-byte frame encoding and CRC32C checksum calculation.
 */

#include "zephyr_wire.h"
#include <string.h>

#define CRC32C_POLYNOMIAL 0x82F63B78

static uint32_t crc32c_table[256];
static int table_initialized = 0;

static void init_crc32c_table(void) {
    for (uint32_t i = 0; i < 256; i++) {
        uint32_t crc = i;
        for (int j = 0; j < 8; j++) {
            crc = (crc >> 1) ^ ((crc & 1) ? CRC32C_POLYNOMIAL : 0);
        }
        crc32c_table[i] = crc;
    }
    table_initialized = 1;
}

uint32_t zephyr_crc32c(const uint8_t *data, size_t length, uint32_t initial) {
    if (!table_initialized) {
        init_crc32c_table();
    }
    uint32_t crc = initial ^ 0xFFFFFFFF;
    for (size_t i = 0; i < length; i++) {
        crc = crc32c_table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return crc ^ 0xFFFFFFFF;
}

size_t zephyr_encode_frame(uint8_t *out_buffer,
                           zephyr_record_type_t type,
                           uint64_t offset,
                           int64_t timestamp,
                           uint64_t correlation_id,
                           const uint8_t *key, size_t key_len,
                           const uint8_t *value, size_t value_len) {
    uint32_t payload_len = (uint32_t)(key_len + value_len);
    size_t unaligned_total = ZEPHYR_HEADER_SIZE + payload_len;
    size_t padding = (8 - (unaligned_total % 8)) % 8;
    size_t total_size = unaligned_total + padding;

    zephyr_header_t *hdr = (zephyr_header_t *)out_buffer;
    memset(hdr, 0, ZEPHYR_HEADER_SIZE);

    hdr->magic = ZEPHYR_FRAME_MAGIC;
    hdr->payload_len = payload_len;
    hdr->type = (uint16_t)type;
    hdr->flags = 0;
    hdr->offset = offset;
    hdr->timestamp = timestamp;
    hdr->key_len = (uint32_t)key_len;
    hdr->meta_len = 0;
    hdr->correlation_id = correlation_id;

    uint8_t *write_ptr = out_buffer + ZEPHYR_HEADER_SIZE;
    if (key_len > 0 && key != NULL) {
        memcpy(write_ptr, key, key_len);
        write_ptr += key_len;
    }
    if (value_len > 0 && value != NULL) {
        memcpy(write_ptr, value, value_len);
        write_ptr += value_len;
    }

    if (padding > 0) {
        memset(write_ptr, 0, padding);
    }

    // Checksum over header[12..63] and entire payload
    uint32_t header_crc = zephyr_crc32c(out_buffer + 12, 52, 0);
    uint32_t total_crc = payload_len > 0
        ? zephyr_crc32c(out_buffer + ZEPHYR_HEADER_SIZE, payload_len, header_crc)
        : header_crc;

    hdr->checksum = total_crc;
    return total_size;
}
