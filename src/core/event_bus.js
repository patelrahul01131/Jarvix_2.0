const EventEmitter = require('events');

/**
 * Event Broker and Event Migration Layer (V7 Spec)
 * Decouples conversation, scheduler, and workspace runtimes.
 */
class EventBroker extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.journal = [];
  }

  // Event Migration Layer
  migrateEvent(event) {
    // Basic migration logic: ensure namespace naming convention
    let eventName = event.eventName || event.eventType || "unknown";
    
    // Map legacy names to namespaces
    if (eventName === "GoalCreated") eventName = "transaction.created";
    if (eventName === "GoalCompleted") eventName = "transaction.committed";
    if (eventName === "WaitingForApproval") eventName = "patch.generated";

    return {
      eventName,
      schemaVersion: event.schemaVersion || 1,
      payload: event.payload || event.data || {},
      timestamp: event.timestamp || Date.now()
    };
  }

  emitEvent(eventName, payload) {
    const rawEvent = {
      eventName,
      schemaVersion: 1,
      payload,
      timestamp: Date.now()
    };
    const migrated = this.migrateEvent(rawEvent);
    this.emit(migrated.eventName, migrated);
    this.emit("event", migrated); // Global stream
  }

  writeJournalEvent(correlationId, eventType, data) {
    const rawEvent = {
      correlationId,
      eventType,
      data,
      timestamp: Date.now()
    };
    const migrated = this.migrateEvent(rawEvent);
    this.journal.push(migrated);
    this.emit(migrated.eventName, migrated);
    this.emit("event", migrated);
    return migrated;
  }

  getJournalForCorrelationId(correlationId) {
    return this.journal.filter(e => e.payload.transactionId === correlationId || e.payload.correlationId === correlationId);
  }
}

const eventBus = new EventBroker();

const EVENTS = {
  GOAL_CREATED: 'transaction.created',
  GOAL_COMPLETED: 'transaction.committed',
  GOAL_PAUSED: 'transaction.paused',
  GOAL_RESUMED: 'transaction.resumed',
  GOAL_FAILED: 'transaction.failed',
  BELIEF_UPDATED: 'belief.updated',
  LOCK_ACQUIRED: 'lock.acquired',
  PATCH_GROUP_CREATED: 'patch.generated',
  WAITING_FOR_APPROVAL: 'patch.waiting_approval'
};

module.exports = { eventBus, EVENTS, EventBroker };
