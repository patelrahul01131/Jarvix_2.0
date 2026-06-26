'use strict';

/**
 * Context Builder
 * 
 * Assembles the full context for the Thinker node.
 * This is the central brain assembly module that replaces the old 
 * "pass raw chat history everywhere" anti-pattern. It produces a 
 * highly structured state object containing exactly what the agent 
 * needs to reason about its next step.
 */

const { TOOL_REGISTRY } = require('./toolRegistry');
const { observationStore } = require('./observation_store');
const { worldStateService } = require('./world_state_service');

const { skillRegistry } = require('./skills/skill_registry');

function buildToolContext() {
  const tools = skillRegistry.getAllSkills().reduce((acc, skill) => {
    acc[skill.name] = {
      description: skill.description,
      schema: { input: "object" }, // Generic for now, can be expanded
      risk: "low"
    };
    return acc;
  }, {});

  // Dynamic tool pickup from TOOL_REGISTRY
  for (const [toolName, toolDef] of Object.entries(TOOL_REGISTRY)) {
    tools[toolName] = {
      description: toolDef.description,
      schema: toolDef.schema,
      risk: toolDef.risk || "low"
    };
  }

  return tools;
}

async function buildThinkerContext(state, args) {
  // 1. Available Skills (We now reason in Skills, not Tools)
  const availableTools = buildToolContext();

  return {
    // 1. Core Execution State
    goal: state.goal,
    currentIntent: state.intent,
    plan: state.plan,
    workingMemory: state.workingMemory || {},

    // 2. Budgeted Context Feed (from feed_manager -> budget_manager)
    // This pre-ranked, budgeted array already contains:
    // - Execution State
    // - Working Memory
    // - Semantic/Episodic Vector hits
    // - Observations & Beliefs
    // - World Model
    contextFeed: state.retrievedContext || [],

    // 3. Available Skills
    availableTools,

    // 4. Execution constraints
    executionBudget: state.executionBudget || null,
    
    // (Legacy fallbacks for safety during migration)
    task: state.task || null,
    recentMessages: (state.recentMessages || []).slice(-8)
  };
}

module.exports = {
  buildThinkerContext,
  buildToolContext
};
