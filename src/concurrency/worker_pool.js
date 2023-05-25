/**
 * src/concurrency/worker_pool.js
 *
 * Worker pool managing background pipeline worker threads for parallel
 * stream transformations, window evaluation, and pattern matching.
 */

import { Worker } from "node:worker_threads";
import path from "node:path";
import os from "node:os";
import { SharedMemoryCoordinator } from "./shared_memory.js";

export class WorkerPool {
  /**
   * @param {object} [options]
   * @param {number} [options.size] Number of worker threads (default os.cpus().length)
   * @param {string} [options.workerScript] Path to worker script
   * @param {boolean} [options.useSharedMemory=true] Whether to allocate shared memory coordinator
   */
  constructor({
    size = Math.max(2, os.cpus().length),
    workerScript = path.join(path.dirname(new URL(import.meta.url).pathname), "pipeline_worker.js"),
    useSharedMemory = true,
  } = {}) {
    this.size = size;
    this.workerScript = workerScript;
    this.useSharedMemory = useSharedMemory;

    this.workers = [];
    this.pendingTasks = new Map();
    this.taskIdCounter = 0n;
    this.nextWorkerIdx = 0;
    this.isClosed = false;

    this.coordinator = useSharedMemory ? new SharedMemoryCoordinator() : null;
  }

  /**
   * Spawns worker threads and establishes communication ports.
   */
  async start() {
    for (let i = 0; i < this.size; i++) {
      const workerData = {
        workerId: i,
        slotCount: this.coordinator?.slotCount,
        slotSizeBytes: this.coordinator?.slotSizeBytes,
        sharedBuffer: this.coordinator?.sharedBuffer,
      };

      const worker = new Worker(this.workerScript, { workerData });

      worker.on("message", (msg) => {
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "TASK_RESULT") {
          const promisePair = this.pendingTasks.get(msg.taskId);
          if (promisePair) {
            this.pendingTasks.delete(msg.taskId);
            if (msg.success) {
              promisePair.resolve(msg.result);
            } else {
              promisePair.reject(new Error(msg.error));
            }
          }
        }
      });

      worker.on("error", (err) => {
        // Reject all tasks dispatched to this worker
        for (const [id, pair] of this.pendingTasks) {
          pair.reject(err);
        }
        this.pendingTasks.clear();
      });

      this.workers.push(worker);
    }
  }

  /**
   * Dispatches a streaming task to an available worker.
   *
   * @param {string} operation Operation name (e.g. TRANSFORM, FILTER)
   * @param {*} payload Task payload
   * @returns {Promise<*>}
   */
  dispatch(operation, payload) {
    if (this.isClosed) {
      return Promise.reject(new Error("WorkerPool is closed"));
    }

    const taskId = (this.taskIdCounter++).toString();
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;

    return new Promise((resolve, reject) => {
      this.pendingTasks.set(taskId, { resolve, reject });
      worker.postMessage({
        type: "EXECUTE_TASK",
        taskId,
        operation,
        payload,
      });
    });
  }

  /**
   * Gracefully terminates all workers in the pool.
   *
   * @returns {Promise<void>}
   */
  async close() {
    this.isClosed = true;
    for (const worker of this.workers) {
      await worker.terminate();
    }
    this.workers = [];
    this.pendingTasks.clear();
  }
}
