'use strict';

const { workingMemory } = require('./working_memory');
const { contextRetriever } = require('../retrieval/context_retriever');
const { workspaceGraph } = require('../retrieval/workspace_graph');

class MemoryFeedManager {
  /**
   * Retrieves and ranks all relevant memory streams into a single context feed.
   * @param {string} sessionId 
   * @param {import('../agent-core/types').ExecutionState} executionState 
   * @returns {Promise<import('../agent-core/types').ContextItem[]>}
   */
  async getContextFeed(sessionId, executionState) {
    /** @type {import('../agent-core/types').ContextItem[]} */
    const feed = [];

    // 1. Execution State (Score: 1.0)
    feed.push({
      source: "execution_state",
      score: 1.0,
      content: {
        goal: executionState.goal,
        plan: executionState.plan,
        currentStep: executionState.workingMemory?.currentStep,
        entities: executionState.workingMemory?.entities,
      }
    });

    // 2. Working Memory (Score: 0.95)
    const wm = workingMemory.getMemory(sessionId, executionState.goal);
    feed.push({
      source: "working_memory",
      score: 0.95,
      content: {
        activeTasks: wm.activeTasks || [],
        currentGoal: wm.activeGoal || executionState.goal,
        currentPlan: wm.currentPlan || executionState.plan,
        recentFindings: wm.recentFindings || []
      }
    });

    // 3. World Model (Score: 0.9)
    try {
      const { worldStateService } = require('../agent-core/world_state_service');
      const ws = worldStateService.getProjectState(process.cwd());
      if (ws && Object.keys(ws).length > 0) {
        feed.push({
          source: "world_model",
          score: 0.9,
          content: ws
        });
      }
    } catch(e) {}

    // 4. Semantic & Episodic Memory (LanceDB Retrieval) (Score: 0.85)
    const query = executionState.goal || "";
    const retrievedMemories = await contextRetriever.retrieve(query, 5);
    feed.push(...retrievedMemories.map(m => ({ ...m, score: m.score * 0.85 })));

    // 5. Observations & Beliefs (Score: 0.8)
    try {
      const { observationStore } = require('../agent-core/observation_store');
      const { memoryManager } = require('./memory_manager');
      const observations = observationStore.getRecent(sessionId, 5);
      const beliefs = memoryManager.getAllBeliefs ? memoryManager.getAllBeliefs() : [];
      feed.push({
        source: "observations_and_beliefs",
        score: 0.8,
        content: {
          observations: observations || [],
          beliefs: beliefs.filter(b => b.confidence > 0.5)
        }
      });
    } catch(e) {}

    // Sort by score descending
    return feed.sort((a, b) => b.score - a.score);
  }
}

const memoryFeedManager = new MemoryFeedManager();
module.exports = { memoryFeedManager, MemoryFeedManager };
