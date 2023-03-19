/**
 * src/common/crc32c.js
 *
 * Castagnoli CRC32C implementation utilizing the 0x82F63B78 polynomial (reversed: 0x1EDC6F41).
 * Standardized in RFC 3720 (iSCSI), ext4, and modern distributed storage engines.
 *
 * Implements an 8-slice lookup table (Sliced-by-8 algorithm) allowing pure JavaScript
 * execution to process 8 bytes per iteration, yielding near-hardware speeds on V8.
 */

// Castagnoli reversed generator polynomial
const POLYNOMIAL = 0x82F63B78;

// Sliced-by-8 lookup tables (8 tables x 256 entries each, 32-bit unsigned integers)
const TABLE = new Uint32Array(8 * 256);

// Precompute the 8-slice lookup tables at module load time
(function initTables() {
  // Slice 0 (standard 1-byte lookup table)
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? POLYNOMIAL : 0);
    }
    TABLE[i] = crc >>> 0;
  }

  // Slices 1 through 7 for multi-byte stride processing
  for (let slice = 1; slice < 8; slice++) {
    const prevOffset = (slice - 1) * 256;
    const currOffset = slice * 256;
    for (let i = 0; i < 256; i++) {
      const prev = TABLE[prevOffset + i];
      TABLE[currOffset + i] = (TABLE[prev & 0xFF] ^ (prev >>> 8)) >>> 0;
    }
  }
})();

/**
 * Updates a running CRC32C checksum with a chunk of bytes.
 *
 * @param {number} prevCrc Initial or previous CRC32C checksum (default: 0)
 * @param {Uint8Array|Buffer} buffer Byte buffer containing data to checksum
 * @param {number} [offset=0] Starting byte offset
 * @param {number} [length] Number of bytes to process
 * @returns {number} 32-bit unsigned integer representing updated CRC32C
 */
export function crc32cUpdate(prevCrc, buffer, offset = 0, length = undefined) {
  const len = length !== undefined ? length : (buffer.length - offset);
  const end = offset + len;

  let crc = (prevCrc ^ 0xFFFFFFFF) >>> 0;
  let idx = offset;

  // Process 8-byte blocks using sliced-by-8 table
  const unrolledLimit = end - 8;
  while (idx <= unrolledLimit) {
    const b0 = buffer[idx] ^ (crc & 0xFF);
    const b1 = buffer[idx + 1] ^ ((crc >>> 8) & 0xFF);
    const b2 = buffer[idx + 2] ^ ((crc >>> 16) & 0xFF);
    const b3 = buffer[idx + 3] ^ ((crc >>> 24) & 0xFF);
    const b4 = buffer[idx + 4];
    const b5 = buffer[idx + 5];
    const b6 = buffer[idx + 6];
    const b7 = buffer[idx + 7];

    crc = (
      TABLE[7 * 256 + b0] ^
      TABLE[6 * 256 + b1] ^
      TABLE[5 * 256 + b2] ^
      TABLE[4 * 256 + b3] ^
      TABLE[3 * 256 + b4] ^
      TABLE[2 * 256 + b5] ^
      TABLE[1 * 256 + b6] ^
      TABLE[0 * 256 + b7]
    ) >>> 0;

    idx += 8;
  }

  // Handle remaining bytes (0 to 7) with single-byte lookup table
  while (idx < end) {
    crc = (TABLE[(crc ^ buffer[idx]) & 0xFF] ^ (crc >>> 8)) >>> 0;
    idx++;
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Computes the Castagnoli CRC32C checksum over a buffer.
 *
 * @param {Uint8Array|Buffer} buffer Input data buffer
 * @param {number} [offset=0] Starting offset
 * @param {number} [length] Total bytes to process
 * @returns {number} 32-bit unsigned integer checksum
 */
export function crc32c(buffer, offset = 0, length = undefined) {
  return crc32cUpdate(0, buffer, offset, length);
}

/**
 * Formats a 32-bit CRC32C integer as an 8-character uppercase hexadecimal string.
 *
 * @param {number} crc 32-bit unsigned integer
 * @returns {string} Hex string (e.g., "0x82F63B78")
 */
export function crc32cHex(crc) {
  return "0x" + (crc >>> 0).toString(16).padStart(8, "0").toUpperCase();
}
