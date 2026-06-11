const JournalEvent = require("../core/models/journal_event");
const DatabaseManager = require("../memory/database");

/**
 * Execution Journal
 * Implements the Event Sourcing pattern for perfect crash recovery.
 */
class ExecutionJournal {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.inMemoryEvents = [];
  }

  /**
   * Log a new event to the journal.
   */
  logEvent(goalId, action, beforeState, afterState, result) {
    const event = new JournalEvent({
      goalId,
      action,
      beforeState,
      afterState,
      result
    });

    this.inMemoryEvents.push(event);
    
    // In production, this might be debounced or batched
    if (this.dbManager) {
      this.dbManager.insertJournalEvent(event);
    }
    
    return event;
  }

  /**
   * Replays events from a given timestamp to reconstruct state.
   */
  replayFrom(timestamp) {
    // In a real implementation, we would query the database for events > timestamp.
    // This is a stub for the recovery logic.
    return this.inMemoryEvents.filter(e => new Date(e.timestamp) > new Date(timestamp));
  }
}

module.exports = ExecutionJournal;
