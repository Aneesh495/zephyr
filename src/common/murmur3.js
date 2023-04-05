/**
 * src/common/murmur3.js
 *
 * MurmurHash3 implementation (32-bit and 128-bit variants) by Austin Appleby.
 * Used across Zephyr for consistent hash ring partition assignment, bloom filters,
 * and hash-join bucket indexing.
 */

const C1_32 = 0xCC9E2D51;
const C2_32 = 0x1B873593;

/**
 * Computes 32-bit MurmurHash3 for a string or byte buffer.
 *
 * @param {string|Buffer|Uint8Array} key Input key
 * @param {number} [seed=0] Seed value
 * @returns {number} 32-bit unsigned integer hash
 */
export function murmur3_32(key, seed = 0) {
  const buf = Buffer.isBuffer(key)
    ? key
    : Buffer.from(typeof key === "string" ? key : String(key), "utf8");

  const len = buf.length;
  const nblocks = len >>> 2;
  let h = seed >>> 0;

  // Process 4-byte chunks
  for (let i = 0; i < nblocks; i++) {
    const idx = i << 2;
    let k = (buf[idx]) |
            (buf[idx + 1] << 8) |
            (buf[idx + 2] << 16) |
            (buf[idx + 3] << 24);

    k = Math.imul(k, C1_32);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, C2_32);

    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xE6546B64) >>> 0;
  }

  // Handle tail bytes
  const tailIdx = nblocks << 2;
  let k1 = 0;
  switch (len & 3) {
    case 3:
      k1 ^= buf[tailIdx + 2] << 16;
      // fall through
    case 2:
      k1 ^= buf[tailIdx + 1] << 8;
      // fall through
    case 1:
      k1 ^= buf[tailIdx];
      k1 = Math.imul(k1, C1_32);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, C2_32);
      h ^= k1;
      break;
  }

  // Finalization mix - force all bits to avalanche
  h ^= len;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85EBCA6B);
  h ^= h >>> 13;
  h = Math.imul(h, 0xC2B2AE35);
  h ^= h >>> 16;

  return h >>> 0;
}

/**
 * Computes 128-bit MurmurHash3 (x64 variant) returning a 16-byte Buffer.
 *
 * @param {string|Buffer|Uint8Array} key Input data
 * @param {number} [seed=0] Seed
 * @returns {Buffer} 16-byte hash digest
 */
export function murmur3_128(key, seed = 0) {
  const buf = Buffer.isBuffer(key)
    ? key
    : Buffer.from(typeof key === "string" ? key : String(key), "utf8");

  const len = BigInt(buf.length);
  let h1 = BigInt(seed);
  let h2 = BigInt(seed);

  const c1 = 0x87C37B91114253D5n;
  const c2 = 0x4CF5AD432745937Fn;
  const mask64 = 0xFFFFFFFFFFFFFFFFn;

  function rotl64(x, r) {
    const s = BigInt(r);
    return (((x << s) & mask64) | (x >> (64n - s))) & mask64;
  }

  function fmix64(k) {
    let x = k & mask64;
    x = (x ^ (x >> 33n)) & mask64;
    x = (x * 0xFF51AFD7ED558CCDn) & mask64;
    x = (x ^ (x >> 33n)) & mask64;
    x = (x * 0xC4CEB9FE1A85EC53n) & mask64;
    x = (x ^ (x >> 33n)) & mask64;
    return x;
  }

  const nblocks = buf.length >>> 4;

  for (let i = 0; i < nblocks; i++) {
    const idx = i << 4;
    let k1 = buf.readBigUInt64LE(idx);
    let k2 = buf.readBigUInt64LE(idx + 8);

    k1 = (k1 * c1) & mask64;
    k1 = rotl64(k1, 31);
    k1 = (k1 * c2) & mask64;
    h1 = (h1 ^ k1) & mask64;

    h1 = rotl64(h1, 27);
    h1 = (h1 + h2) & mask64;
    h1 = ((h1 * 5n) + 0x52DCE729n) & mask64;

    k2 = (k2 * c2) & mask64;
    k2 = rotl64(k2, 33);
    k2 = (k2 * c1) & mask64;
    h2 = (h2 ^ k2) & mask64;

    h2 = rotl64(h2, 31);
    h2 = (h2 + h1) & mask64;
    h2 = ((h2 * 5n) + 0x38495AB5n) & mask64;
  }

  const tailIdx = nblocks << 4;
  const rem = buf.length & 15;
  let k1 = 0n;
  let k2 = 0n;

  if (rem > 8) {
    for (let i = rem - 1; i >= 8; i--) {
      k2 = ((k2 << 8n) | BigInt(buf[tailIdx + i])) & mask64;
    }
    k2 = (k2 * c2) & mask64;
    k2 = rotl64(k2, 33);
    k2 = (k2 * c1) & mask64;
    h2 = (h2 ^ k2) & mask64;
  }

  if (rem > 0) {
    const lim = Math.min(rem, 8);
    for (let i = lim - 1; i >= 0; i--) {
      k1 = ((k1 << 8n) | BigInt(buf[tailIdx + i])) & mask64;
    }
    k1 = (k1 * c1) & mask64;
    k1 = rotl64(k1, 31);
    k1 = (k1 * c2) & mask64;
    h1 = (h1 ^ k1) & mask64;
  }

  h1 = (h1 ^ len) & mask64;
  h2 = (h2 ^ len) & mask64;

  h1 = (h1 + h2) & mask64;
  h2 = (h2 + h1) & mask64;

  h1 = fmix64(h1);
  h2 = fmix64(h2);

  h1 = (h1 + h2) & mask64;
  h2 = (h2 + h1) & mask64;

  const result = Buffer.alloc(16);
  result.writeBigUInt64LE(h1, 0);
  result.writeBigUInt64LE(h2, 8);
  return result;
}
