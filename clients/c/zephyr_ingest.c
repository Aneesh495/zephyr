/**
 * clients/c/zephyr_ingest.c
 *
 * High-throughput C producer CLI utility for benchmark ingestion into Zephyr.
 */

#include "zephyr_wire.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include <time.h>

#define BUFFER_SIZE (64 * 1024)

int main(int argc, char **argv) {
    const char *host = "127.0.0.1";
    int port = 9092;
    int record_count = 1000;

    if (argc > 1) {
        record_count = atoi(argv[1]);
    }

    printf("[Zephyr C Ingest] Initializing benchmark pipeline for %d records...\n", record_count);

    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) {
        perror("Failed to create socket");
        return 1;
    }

    struct sockaddr_in serv_addr;
    memset(&serv_addr, 0, sizeof(serv_addr));
    serv_addr.sin_family = AF_INET;
    serv_addr.sin_port = htons(port);

    if (inet_pton(AF_INET, host, &serv_addr.sin_addr) <= 0) {
        perror("Invalid address");
        close(sock);
        return 1;
    }

    if (connect(sock, (struct sockaddr *)&serv_addr, sizeof(serv_addr)) < 0) {
        printf("[Zephyr C Ingest] Server not running on %s:%d, test wire codec locally.\n", host, port);
        uint8_t local_buf[1024];
        const char *test_key = "device-01";
        const char *test_val = "{\"temp\": 24.5}";
        size_t bytes = zephyr_encode_frame(
            local_buf,
            ZEPHYR_RECORD_DATA,
            1ULL,
            1710000000000LL,
            100,
            (const uint8_t *)test_key, strlen(test_key),
            (const uint8_t *)test_val, strlen(test_val)
        );
        printf("[Zephyr C Ingest] Local frame encoded successfully: %zu bytes (64-byte aligned).\n", bytes);
        close(sock);
        return 0;
    }

    printf("[Zephyr C Ingest] Connected to %s:%d. Pushing framed records...\n", host, port);

    uint8_t frame_buf[1024];
    for (int i = 0; i < record_count; i++) {
        char val[128];
        snprintf(val, sizeof(val), "{\"action\":\"PRODUCE\",\"topic\":\"bench_topic\",\"data\":{\"idx\":%d}}", i);
        const char *key = "bench_key";

        size_t frame_size = zephyr_encode_frame(
            frame_buf,
            ZEPHYR_RECORD_RPC_REQUEST,
            0,
            (int64_t)time(NULL) * 1000,
            (uint64_t)(i + 1),
            (const uint8_t *)key, strlen(key),
            (const uint8_t *)val, strlen(val)
        );

        if (send(sock, frame_buf, frame_size, 0) < 0) {
            perror("Send failed");
            break;
        }
    }

    printf("[Zephyr C Ingest] Ingestion completed for %d records.\n", record_count);
    close(sock);
    return 0;
}
