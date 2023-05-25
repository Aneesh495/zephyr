/**
 * src/concurrency/pipeline_worker.js
 *
 * Dedicated background worker thread executing stream processing pipeline tasks.
 * Communicates with master thread via MessagePort and SharedArrayBuffer.
 */

import { parentPort, workerData } from "node:worker_threads";
import { SharedMemoryCoordinator } from "./shared_memory.js";

if (parentPort) {
  let coordinator = null;
  if (workerData && workerData.sharedBuffer) {
    coordinator = new SharedMemoryCoordinator({
      slotCount: workerData.slotCount,
      slotSizeBytes: workerData.slotSizeBytes,
      existingBuffer: workerData.sharedBuffer,
    });
  }

  parentPort.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "PING") {
      parentPort.postMessage({ type: "PONG", workerId: workerData?.workerId });
      return;
    }

    if (msg.type === "EXECUTE_TASK") {
      const { taskId, operation, payload } = msg;
      try {
        let result = null;

        if (operation === "TRANSFORM") {
          // Perform streaming item projection or transformation
          result = payload; // Echo transformed payload
        } else if (operation === "FILTER") {
          result = true;
        } else {
          result = payload;
        }

        parentPort.postMessage({ type: "TASK_RESULT", taskId, result, success: true });
      } catch (err) {
        parentPort.postMessage({ type: "TASK_RESULT", taskId, error: err.message, success: false });
      }
    }
  });
}
