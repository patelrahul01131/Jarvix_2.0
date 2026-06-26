'use strict';

/**
 * State Updater — src/agent-core/state_updater.js
 *
 * Extracted from loop.js `executeNode()`.
 * Updates episodic memory and failure memory traces based on tool execution results.
 *
 * RESPONSIBILITIES:
 *   - Record tool executions to episodic memory
 *   - Record failures to failure memory
 *   - Append simple observation logs to recent messages
 *
 * DOES NOT:
 *   - Verify outcomes (that's verifier.js)
 *   - Execute tools (that's executor.js)
 */

const shortTerm = require('../memory/shortTerm');

/**
 * Update agent state and session memories following a tool execution.
 *
 * @param {object} state     - The current agent LangGraph state
 * @param {object} execRes   - The result from executor.js
 * @param {object} args      - Runtime arguments (sessionId, etc)
 * @param {string} observationLog - The formatted observation text
 * @returns {object} Partial state update { recentMessages, failureMemory }
 */
async function updateAgentState(state, execRes, args, observationLog) {
  const newMessages = [...(state.recentMessages || []), observationLog].slice(-50);
  const failureMemory = state.failureMemory || [];
  
  if (!args || !args.sessionId) {
    return {
      recentMessages: newMessages,
      failureMemory,
    };
  }

  const sess = shortTerm.getSession(args.sessionId);
  if (sess) {
    sess.messages.push({ role: 'system', content: observationLog });

    // --- Episodic Replay System ---
    if (!sess.episodicMemory) sess.episodicMemory = [];
    const traceEntry = {
      timestamp:  Date.now(),
      tool:       state.action ? state.action.tool : 'unknown',
      input:      state.action ? state.action.input : {},
      success:    execRes.success !== false,
      summary:    `Action: ${state.action ? state.action.tool : 'unknown'}. Result: ${execRes.success !== false ? 'SUCCESS' : 'FAILED - ' + (execRes.stderr || 'Unknown error')}`,
      importance: execRes.success !== false ? 30 : 80,
    };
    sess.episodicMemory.push(traceEntry);

    // --- Failure Memory ---
    if (execRes.success === false) {
      const failEntry = {
        type:      'tool_error',
        tool:      state.action ? state.action.tool : 'unknown',
        error:     execRes.stderr || 'Unknown execution error',
        timestamp: Date.now(),
        resolved:  false,
      };
      failureMemory.push(failEntry);
      sess.failureMemory = failureMemory;
    }

    shortTerm.saveSession(args.sessionId, sess);
  }

  return {
    recentMessages: newMessages,
    failureMemory,
  };
}

module.exports = { updateAgentState };
