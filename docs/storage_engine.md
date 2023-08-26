# Zephyr Storage Engine Specification

Zephyr features a segmented, append-only Write-Ahead Log (WAL) storage engine optimized for NVMe sequential writes and sub-millisecond index lookups.

---

## Binary Frame Layout (64-Byte Header)

```
Offset (Bytes)   Field               Type / Description
-----------------------------------------------------------------------------------
00..03           Magic               0x5A455048 ("ZEPH" in Little-Endian)
04..07           Payload Length      uint32 LE (bytes of key + metadata + value)
08..11           CRC32C Checksum     uint32 LE (Castagnoli over header[12..63] + payload)
12..13           Record Type         uint16 LE (DATA, WATERMARK, CHECKPOINT, etc.)
14..15           Flags               uint16 LE (TOMBSTONE, COMPRESSED, CONTROL)
16..23           Offset / Sequence   uint64 LE (Monotonic partition offset)
24..31           Timestamp           int64 LE (Unix epoch milliseconds)
32..35           Key Length          uint32 LE (bytes of partition key)
36..39           Metadata Length     uint32 LE (bytes of optional metadata)
40..47           Correlation ID      uint64 LE (RPC transaction matching token)
48..63           Reserved            16 bytes zero-filled (cache line alignment padding)
64..(64+L-1)     Payload Data        Key bytes + Metadata bytes + Value bytes
Pad              Alignment Pad       0 to 7 bytes to pad record to 8-byte boundary
```

---

## Sparse Radix Index Architecture

Rather than maintaining an index pointer for every individual record, Zephyr records an index entry every `indexIntervalBytes` (default: 4096 bytes). Each entry occupies exactly 12 bytes on disk:
- `[00..03]` Relative Offset: uint32 (logical offset minus segment base offset)
- `[04..11]` Physical Position: uint64 (exact byte offset inside the `.seg` file)

### Logarithmic Lookup Procedure
To find a record at target offset `T`:
1. Binary search over segment base offsets to locate the target segment: O(log S).
2. Binary search within the segment's in-memory sparse index to find the largest indexed offset `<= T`: O(log E).
3. Seek directly to the indexed physical file position and scan sequentially across at most 4KB of framed records to reach `T`.

---

## Log Compaction & Tombstone Purging

Changelog topics require bounded storage growth. The background compactor executes in three phases:
1. **Key Indexing**: Scans all sealed historical segments and builds a map of the latest offset for each key.
2. **Deduplication**: Copies the latest record per key into a temporary compacted segment file.
3. **Tombstone Expiration**: If a record has the `TOMBSTONE` flag set or zero payload length, and its age exceeds `tombstoneRetentionMs`, the record is purged entirely from the compacted log.
4. **Atomic Swap**: Replaces the old segment files with the compacted segment.
