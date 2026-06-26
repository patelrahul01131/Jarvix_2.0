'use strict';

const { workingMemory } = require('./working_memory');
const { contextRetriever } = require('../retrieval/context_retriever');

class MemoryLifecycleManager {
  /**
   * Evaluates session completion and promotes/archives memories.
   * @param {string} sessionId 
   * @param {import('../agent-core/types').ExecutionState} executionState 
   * @param {boolean} taskSuccess 
   */
  async processSessionEnd(sessionId, executionState, taskSuccess) {
    console.log(`[MemoryLifecycleManager] Processing session end. Success: ${taskSuccess}`);
    
    const wm = workingMemory.getMemory(sessionId);
    
    if (taskSuccess) {
      // Promote successful execution to Episodic Memory
      const episodicEntry = {
        goal: executionState.goal,
        intent: executionState.intent,
        stepsTaken: wm.completedSteps,
        skillsUsed: executionState.selectedSkills.map(s => s.name),
        timestamp: Date.now()
      };
      
      await contextRetriever.addMemory(
        "episodic_memory", 
        `Achieved goal: ${executionState.goal} by running ${episodicEntry.skillsUsed.join(', ')}`,
        episodicEntry
      );
      console.log(`[MemoryLifecycleManager] Promoted session ${sessionId} to Episodic Memory.`);
    } else {
      // Optionally store failure context to avoid repeating mistakes
      console.log(`[MemoryLifecycleManager] Task failed. Keeping Working Memory active for recovery.`);
    }

    // Noise Deletion: Clean up working memory if goal completely shifted or after long TTL
    // (In a full system, this would run on a cron job cleaning up stale map entries)
    if (taskSuccess) {
      // Clear working memory for this session
      workingMemory.memories.delete(sessionId);
    }
  }
}

const memoryLifecycleManager = new MemoryLifecycleManager();
module.exports = { memoryLifecycleManager, MemoryLifecycleManager };
