const { DatabaseManager } = require("../memory/database");

/**
 * State Serializer
 * Takes periodic snapshots of active goals, locks, and beliefs
 * to compress the event sourcing replay log.
 */
class StateSerializer {
  constructor(dbManager, goalManager, memoryManager, lockManager) {
    this.dbManager = dbManager;
    this.goalManager = goalManager;
    this.memoryManager = memoryManager;
    this.lockManager = lockManager;
  }

  /**
   * Takes a snapshot of the current architectural state.
   */
  createSnapshot() {
    const state = {
      timestamp: new Date().toISOString(),
      goals: {
        active: this.goalManager ? this.goalManager.activeQueue : [],
        blocked: this.goalManager ? this.goalManager.blockedQueue : [],
        all: this.goalManager ? Array.from(this.goalManager.goals.entries()) : []
      },
      beliefs: this.memoryManager ? this.memoryManager.getAllBeliefs() : [],
      locks: this.lockManager ? Array.from(this.lockManager.locks.entries()) : []
    };

    const snapshotJson = JSON.stringify(state);
    
    if (this.dbManager) {
      this.dbManager.saveSnapshot(snapshotJson);
    }

    return state;
  }

  /**
   * Loads the latest snapshot to begin recovery.
   */
  async loadLatestSnapshot() {
    if (!this.dbManager) return null;
    
    const record = this.dbManager.getLatestSnapshot();
    if (!record) return null;

    try {
      return JSON.parse(record.snapshot_json);
    } catch (e) {
      console.error("[StateSerializer] Failed to parse snapshot:", e);
      return null;
    }
  }
}

module.exports = StateSerializer;
