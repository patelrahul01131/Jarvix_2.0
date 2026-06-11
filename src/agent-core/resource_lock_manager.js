const { eventBus, EVENTS } = require("../core/event_bus");
const ResourceLock = require("../core/models/resource_lock");

/**
 * ResourceLockManager
 * Manages concurrency locks to prevent execution collisions across goals.
 */
class ResourceLockManager {
  constructor() {
    this.locks = new Map(); // Map<resourcePath, ResourceLock[]>
  }

  /**
   * Request a lock on a resource for a specific goal.
   * Type can be 'read' or 'write'.
   */
  async acquireLock(resourcePath, goalId, type = "read") {
    if (!this.locks.has(resourcePath)) {
      this.locks.set(resourcePath, []);
    }
    const resourceLocks = this.locks.get(resourcePath);

    // Check for conflicting locks
    const hasConflictingWriteLock = resourceLocks.some(l => l.isWriteLock() && l.ownerGoalId !== goalId);
    
    if (type === "write") {
      // Write locks require exclusive access (no other reads or writes from other goals)
      const hasOtherLocks = resourceLocks.some(l => l.ownerGoalId !== goalId);
      if (hasOtherLocks) {
        throw new Error(`LockAcquisitionFailed: Resource '${resourcePath}' is locked by another goal.`);
      }
    } else {
      // Read locks are blocked if there's a write lock from another goal
      if (hasConflictingWriteLock) {
        throw new Error(`LockAcquisitionFailed: Resource '${resourcePath}' has an active write lock.`);
      }
    }

    // Check if we already have a lock
    const existingLock = resourceLocks.find(l => l.ownerGoalId === goalId);
    if (existingLock) {
      if (type === "write" && !existingLock.isWriteLock()) {
        existingLock.escalateToWrite();
        eventBus.emitEvent(EVENTS.LOCK_ESCALATED, { resourcePath, goalId, type: "write" });
      }
      return existingLock;
    }

    const newLock = new ResourceLock({ resourcePath, ownerGoalId: goalId, type });
    resourceLocks.push(newLock);
    
    eventBus.emitEvent(EVENTS.LOCK_ACQUIRED, { resourcePath, goalId, type });
    return newLock;
  }

  /**
   * Release all locks for a specific goal.
   */
  releaseLocksForGoal(goalId) {
    const releasedPaths = [];
    for (const [path, locks] of this.locks.entries()) {
      const initialCount = locks.length;
      const filteredLocks = locks.filter(l => l.ownerGoalId !== goalId);
      
      if (filteredLocks.length < initialCount) {
        releasedPaths.push(path);
        if (filteredLocks.length === 0) {
          this.locks.delete(path);
        } else {
          this.locks.set(path, filteredLocks);
        }
      }
    }

    if (releasedPaths.length > 0) {
      eventBus.emitEvent(EVENTS.LOCK_RELEASED, { goalId, releasedPaths });
    }
  }

  /**
   * Release a specific lock on a resource for a goal.
   */
  releaseLock(resourcePath, goalId) {
    if (!this.locks.has(resourcePath)) return;
    
    const locks = this.locks.get(resourcePath);
    const filteredLocks = locks.filter(l => l.ownerGoalId !== goalId);
    
    if (filteredLocks.length === 0) {
      this.locks.delete(resourcePath);
    } else {
      this.locks.set(resourcePath, filteredLocks);
    }
    
    eventBus.emitEvent(EVENTS.LOCK_RELEASED, { goalId, releasedPaths: [resourcePath] });
  }

  /**
   * Cleans up expired locks periodically.
   */
  cleanupExpired() {
    for (const [path, locks] of this.locks.entries()) {
      const validLocks = locks.filter(l => !l.isExpired());
      if (validLocks.length < locks.length) {
        if (validLocks.length === 0) {
          this.locks.delete(path);
        } else {
          this.locks.set(path, validLocks);
        }
      }
    }
  }
}

// Singleton
const lockManager = new ResourceLockManager();

module.exports = { ResourceLockManager, lockManager };
