// src/agent-core/runtime/WorkspaceLockManager.js
const fs = require("fs");
const path = require("crypto");

class WorkspaceLockManager {
  constructor() {
    this.locks = new Map(); // filePath -> transactionId (exclusive lock)
  }

  acquireLock(transactionId, filePath) {
    const activeLock = this.locks.get(filePath);
    if (activeLock && activeLock !== transactionId) {
      throw new Error(`LOCK_ACQUISITION_FAILED: File '${filePath}' is currently locked by transaction '${activeLock}'`);
    }
    this.locks.set(filePath, transactionId);
    return true;
  }

  releaseLock(transactionId, filePath) {
    const activeLock = this.locks.get(filePath);
    if (activeLock === transactionId) {
      this.locks.delete(filePath);
    }
  }

  verifyNoConflict(filePath, expectedHash) {
    if (!fs.existsSync(filePath)) {
      if (expectedHash !== "" && expectedHash !== null) {
        throw new Error(`CONFLICT_DETECTED: File '${filePath}' does not exist, but expected a hash.`);
      }
      return;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const actualHash = require("crypto").createHash("sha256").update(content).digest("hex");
    if (expectedHash && actualHash !== expectedHash) {
      throw new Error(`CONFLICT_DETECTED: File '${filePath}' was modified concurrently by user. Expected hash: ${expectedHash}, Actual: ${actualHash}`);
    }
  }
}

module.exports = WorkspaceLockManager;
