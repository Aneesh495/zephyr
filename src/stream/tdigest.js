/**
 * src/stream/tdigest.js
 *
 * Ted Dunning's T-Digest online streaming quantile estimation algorithm.
 * Uses adaptive clustering where centroids at the tails (q -> 0 and q -> 1)
 * are constrained to minimal size for sub-percentile accuracy (P99, P99.9).
 */

class Centroid {
  constructor(mean, weight) {
    this.mean = mean;
    this.weight = weight;
  }
}

export class TDigest {
  /**
   * @param {number} [delta=100] Compression parameter governing accuracy vs memory
   */
  constructor(delta = 100) {
    this.delta = delta;
    /** @type {Array<Centroid>} */
    this.centroids = [];
    this.totalWeight = 0;
    this.buffer = [];
    this.bufferLimit = 500;
  }

  /**
   * Adds an observed value with a given weight to the digest.
   *
   * @param {number} value
   * @param {number} [weight=1]
   */
  add(value, weight = 1) {
    this.buffer.push(new Centroid(Number(value), Number(weight)));
    if (this.buffer.length >= this.bufferLimit) {
      this.compress();
    }
  }

  /**
   * Merges buffered points into existing centroids obeying scale function bounds.
   */
  compress() {
    if (this.buffer.length === 0) return;

    const all = this.centroids.concat(this.buffer);
    all.sort((a, b) => a.mean - b.mean);

    let totalW = 0;
    for (const c of all) totalW += c.weight;
    this.totalWeight = totalW;

    const newCentroids = [];
    let current = all[0];
    let weightSoFar = 0;

    for (let i = 1; i < all.length; i++) {
      const next = all[i];
      const proposedWeight = current.weight + next.weight;
      const q = (weightSoFar + current.weight / 2) / totalW;

      // Ted Dunning scale function k1 threshold: 4 * totalW * q * (1 - q) / delta
      const maxWeight = (4 * totalW * q * (1 - q)) / this.delta;

      if (proposedWeight <= Math.max(1, maxWeight)) {
        // Merge into current centroid
        const combinedMean = (current.mean * current.weight + next.mean * next.weight) / proposedWeight;
        current.mean = combinedMean;
        current.weight = proposedWeight;
      } else {
        weightSoFar += current.weight;
        newCentroids.push(current);
        current = next;
      }
    }

    newCentroids.push(current);
    this.centroids = newCentroids;
    this.buffer = [];
  }

  /**
   * Estimates the value at quantile q in [0, 1].
   *
   * @param {number} q Quantile (e.g. 0.50 for median, 0.99 for P99)
   * @returns {number} Estimated value
   */
  quantile(q) {
    if (this.buffer.length > 0) {
      this.compress();
    }

    if (this.centroids.length === 0) {
      return 0;
    }

    if (this.centroids.length === 1) {
      return this.centroids[0].mean;
    }

    const rank = q * this.totalWeight;
    let currentWeight = 0;

    for (let i = 0; i < this.centroids.length; i++) {
      const c = this.centroids[i];
      const nextWeight = currentWeight + c.weight;

      if (rank <= nextWeight) {
        if (i === 0) return c.mean;
        const prev = this.centroids[i - 1];
        // Linear interpolation between adjacent centroid means
        const fraction = (rank - currentWeight) / c.weight;
        return prev.mean + fraction * (c.mean - prev.mean);
      }

      currentWeight = nextWeight;
    }

    return this.centroids[this.centroids.length - 1].mean;
  }
}
