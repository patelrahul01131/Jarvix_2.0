const { eventBus, EVENTS } = require("../core/event_bus");
const Belief = require("../core/models/belief");

/**
 * MemoryManager
 * The centralized interface for Jarvix 4.0 Memory Stores.
 * Listens to the EventBus to passively update episodic and failure memory.
 */
class MemoryManager {
  constructor() {
    this.beliefs = new Map(); // Map<key, Belief>
    this.episodicMemory = []; // Array of observations and summaries
    
    this._initializeEventHandlers();
  }

  _initializeEventHandlers() {
    eventBus.on(EVENTS.FAILURE_RECORDED, (payload) => {
      // Passive learning: store failure in episodic
      this.episodicMemory.push({
        type: "failure",
        timestamp: payload.timestamp,
        failure: payload.failure
      });
    });

    eventBus.on(EVENTS.LESSON_LEARNED, (payload) => {
      this.episodicMemory.push({
        type: "lesson",
        timestamp: payload.timestamp,
        lesson: payload.lesson
      });
    });
  }

  /**
   * Upsert a belief into memory, handling contradiction resolution automatically.
   */
  updateBelief(key, value, confidence, reason) {
    if (!this.beliefs.has(key)) {
      const newBelief = new Belief({ key, currentValue: value, confidence });
      this.beliefs.set(key, newBelief);
      eventBus.emitEvent(EVENTS.BELIEF_UPDATED, { key, value, reason });
      return newBelief;
    }

    const belief = this.beliefs.get(key);
    
    // Contradiction resolution
    if (belief.currentValue !== value) {
      eventBus.emitEvent(EVENTS.BELIEF_SUPERSEDED, { 
        key, 
        oldValue: belief.currentValue, 
        newValue: value,
        reason 
      });
    }
    
    belief.update(value, confidence, reason);
    return belief;
  }

  getBelief(key) {
    return this.beliefs.get(key) || null;
  }

  getAllBeliefs() {
    return Array.from(this.beliefs.values());
  }

  addEpisodicEvent(event) {
    this.episodicMemory.push({
      timestamp: new Date().toISOString(),
      ...event
    });
  }

  getRecentEpisodes(limit = 10) {
    return this.episodicMemory.slice(-limit);
  }
}

// Singleton
const memoryManager = new MemoryManager();

module.exports = { MemoryManager, memoryManager };
