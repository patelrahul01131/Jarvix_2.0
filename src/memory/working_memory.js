'use strict';

/**
 * @typedef {Object} WorkingMemoryState
 * @property {string} sessionId
 * @property {string} activeGoal
 * @property {number} currentStep
 * @property {string[]} completedSteps
 * @property {string[]} pendingSteps
 * @property {string[]} blockers
 * @property {string[]} activeTasks
 * @property {string[]} currentPlan
 * @property {string[]} recentFindings
 * @property {Record<string, any>} contextMap
 * @property {number} updatedAt
 */

class WorkingMemoryManager {
  constructor() {
    /** @type {Map<string, WorkingMemoryState>} */
    this.memories = new Map();
  }

  /**
   * Retrieves or initializes the working memory for a session
   * @param {string} sessionId 
   * @param {string} activeGoal 
   * @returns {WorkingMemoryState}
   */
  getMemory(sessionId, activeGoal = "") {
    if (this.memories.has(sessionId)) {
      const memory = this.memories.get(sessionId);
      if (activeGoal && memory.activeGoal !== activeGoal) {
        // Goal shifted, reset working memory for new goal but maybe keep some context
        memory.activeGoal = activeGoal;
        memory.currentStep = 1;
        memory.completedSteps = [];
        memory.pendingSteps = [];
        memory.blockers = [];
        memory.updatedAt = Date.now();
      }
      return memory;
    }

    const initialMemory = {
      sessionId,
      activeGoal,
      currentStep: 1,
      completedSteps: [],
      pendingSteps: [],
      blockers: [],
      activeTasks: [],
      currentPlan: [],
      recentFindings: [],
      contextMap: {},
      updatedAt: Date.now()
    };
    
    this.memories.set(sessionId, initialMemory);
    return initialMemory;
  }

  /**
   * Adds a completed step
   * @param {string} sessionId 
   * @param {string} step 
   */
  addCompletedStep(sessionId, step) {
    const memory = this.getMemory(sessionId);
    memory.completedSteps.push(step);
    memory.currentStep += 1;
    memory.pendingSteps = memory.pendingSteps.filter(p => p !== step);
    memory.updatedAt = Date.now();
  }

  /**
   * Sets pending plan
   * @param {string} sessionId 
   * @param {string[]} steps 
   */
  setPendingPlan(sessionId, steps) {
    const memory = this.getMemory(sessionId);
    memory.pendingSteps = steps;
    memory.updatedAt = Date.now();
  }

  /**
   * Adds a blocker
   * @param {string} sessionId 
   * @param {string} blocker 
   */
  addBlocker(sessionId, blocker) {
    const memory = this.getMemory(sessionId);
    if (!memory.blockers.includes(blocker)) {
      memory.blockers.push(blocker);
      memory.updatedAt = Date.now();
    }
  }

  /**
   * Updates context variables
   * @param {string} sessionId 
   * @param {string} key 
   * @param {any} value 
   */
  setContext(sessionId, key, value) {
    const memory = this.getMemory(sessionId);
    memory.contextMap[key] = value;
    memory.updatedAt = Date.now();
  }
}

const workingMemory = new WorkingMemoryManager();
module.exports = { workingMemory, WorkingMemoryManager };
