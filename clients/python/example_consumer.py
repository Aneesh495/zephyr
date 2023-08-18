#!/usr/bin/env python3
"""
clients/python/example_consumer.py

Example Python consumer application subscribing to Zephyr real-time topics
over the binary framed TCP wire protocol.
"""

import sys
from zephyr_client import ZephyrClient


def main():
    topic = sys.argv[1] if len(sys.argv) > 1 else "market_feed"
    client = ZephyrClient(host="127.0.0.1", port=9092)

    print(f"[Python Consumer] Connecting to Zephyr cluster on 127.0.0.1:9092...")
    try:
        client.connect()
        print(f"[Python Consumer] Connected. Subscribing to topic '{topic}'...")

        for record in client.stream(topic, partition=0):
            print(
                f"[Python Stream] Offset={record['offset']} | Key={record['key']} | "
                f"Value={record['value']}"
            )
    except KeyboardInterrupt:
        print("\n[Python Consumer] Gracefully shutting down.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
