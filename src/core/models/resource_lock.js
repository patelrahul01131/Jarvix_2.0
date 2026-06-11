/**
 * Resource Lock Domain Model
 * Prevents dynamic collisions between concurrent goals.
 */
class ResourceLock {
  constructor(data = {}) {
    this.resourcePath = data.resourcePath || "";
    this.ownerGoalId = data.ownerGoalId || null;
    
    // read, write
    this.type = data.type || "read"; 
    
    this.acquiredAt = data.acquiredAt || new Date().toISOString();
    this.expiresAt = data.expiresAt || null;
  }

  escalateToWrite() {
    this.type = "write";
    this.acquiredAt = new Date().toISOString();
  }

  isWriteLock() {
    return this.type === "write";
  }

  isExpired() {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }
}

module.exports = ResourceLock;
