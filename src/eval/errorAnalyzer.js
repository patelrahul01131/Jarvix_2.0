/**
 * Error Analyzer & Memory
 * Detects infinite error loops by hashing errors and tracking failed solutions.
 */

const crypto = require("crypto");

class ErrorMemory {
  constructor() {
    this.memory = new Map();
  }

  hashError(errorMessage) {
    return crypto.createHash("sha256").update(errorMessage).digest("hex");
  }

  recordAttempt(errorMsg, strategy) {
    const hash = this.hashError(errorMsg);
    if (!this.memory.has(hash)) {
      this.memory.set(hash, []);
    }
    this.memory.get(hash).push(strategy);
  }

  getPreviousAttempts(errorMsg) {
    const hash = this.hashError(errorMsg);
    return this.memory.get(hash) || [];
  }
}

module.exports = { ErrorMemory };
