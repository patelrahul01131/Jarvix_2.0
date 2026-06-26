// src/agent-core/runtime/CapabilityRegistry.js
/**
 * Capability Registry
 * Decouples planner intents from raw implementation tools.
 */

class CapabilityRegistry {
  constructor() {
    this.capabilities = {
      "read": "fs.readFile",
      "write": "fs.writeFile",
      "edit": "fs.editFileLines",
      "delete": "fs.deleteFile",
      "rename": "fs.renameFile",
      "list": "list_dir",
      "execute": "terminal.exec",
      "response": "response",
      "summary": "response",
      "summarize": "response",
      "ask": "ask_user_for_input",
      "search": "google_search"
    };

    // Implements tool-specific retry settings
    this.retryPolicies = {
      "fs.readFile": { retries: 0, timeoutMs: 5000 },
      "fs.writeFile": { retries: 0, timeoutMs: 5000 },
      "fs.editFileLines": { retries: 0, timeoutMs: 5000 },
      "fs.deleteFile": { retries: 0, timeoutMs: 5000 },
      "terminal.exec": { retries: 1, timeoutMs: 30000 },
      "google_search": { retries: 2, timeoutMs: 10000 },
      "response": { retries: 0, timeoutMs: 2000 }
    };

    // Tracks idempotency keys of executed side-effects (e.g. key = "writeFile:package.json:hash")
    this.executedSideEffects = new Set();
  }

  hasCapability(capabilityName) {
    return !!this.capabilities[capabilityName];
  }

  resolve(capabilityName) {
    return this.capabilities[capabilityName];
  }

  getRetryPolicy(toolName) {
    return this.retryPolicies[toolName] || { retries: 1, timeoutMs: 10000 };
  }

  isDuplicate(idempotencyKey) {
    if (this.executedSideEffects.has(idempotencyKey)) {
      return true;
    }
    this.executedSideEffects.add(idempotencyKey);
    return false;
  }

  clearIdempotency() {
    this.executedSideEffects.clear();
  }
}

const capabilityRegistryInstance = new CapabilityRegistry();
module.exports = { CapabilityRegistry: capabilityRegistryInstance };
