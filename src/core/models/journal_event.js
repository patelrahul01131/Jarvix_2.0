/**
 * Journal Event Domain Model
 * Event Sourcing entry for crash recovery and state reconstruction.
 */
class JournalEvent {
  constructor(data = {}) {
    this.id = data.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.goalId = data.goalId || null;
    this.timestamp = data.timestamp || new Date().toISOString();
    
    // The action taken (e.g., Tool call)
    this.action = data.action || {};
    
    // State of the targeted resource BEFORE the action
    this.beforeState = data.beforeState || null;
    
    // State of the targeted resource AFTER the action
    this.afterState = data.afterState || null;
    
    // Execution result (success boolean, output)
    this.result = data.result || null;
  }
}

module.exports = JournalEvent;
