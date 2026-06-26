'use strict';

/**
 * Verifier — src/agent-core/verifier.js
 *
 * Extracted from loop.js `validateAndReflectNode()`.
 * Validates the outcome of a step (tool execution) against reality.
 * 
 * RESPONSIBILITIES:
 *   - Check for truth vs belief mismatches
 *   - Classify execution failures (blocking vs non-blocking)
 *   - Manage execution budget
 *   - Determine if replanning is needed
 *
 * DOES NOT:
 *   - Execute tools
 *   - Call LLMs (that's reflection.js)
 *   - Update persistent memory
 */

const { classifyFailure } = require('./reflection');

/**
 * Validate the results of the execution node and reflect on mismatches.
 *
 * @param {object} state - The current agent state
 * @returns {object} Partial state update { truthState, beliefState, executionBudget, status, chunkFailures }
 */
async function runVerifier(state) {
  // 1. Consistency Rule Engine
  // Rule: truthState > beliefState (always)
  // Rule: validated tool output > model assumption
  let updatedTruth  = { ...(state.truthState || {}) };
  let updatedBelief = { ...(state.beliefState || {}) };
  let mismatchDetected = false;

  // Resolve conflicts by forcing belief to match truth
  if (updatedTruth.files) {
    for (const key in updatedTruth.files) {
      if (updatedBelief.files && updatedBelief.files[key]) {
        if (updatedBelief.files[key].exists !== updatedTruth.files[key].exists) {
          updatedBelief.files[key] = { ...updatedTruth.files[key] };
          mismatchDetected = true;
        }
      }
    }
  }

  let finalStatus = state.status;

  // 2. Failure Classification
  if (state.lastResult && !state.lastResult.success) {
    mismatchDetected = true;
    const failureType = classifyFailure(state.lastResult.stderr || '');

    if (failureType === 'ENVIRONMENT_BLOCKING') {
      if (state.args && state.args.onStatus) {
        state.args.onStatus(`[${new Date().toLocaleTimeString()}] 🛑 BLOCKING ENVIRONMENT ERROR. Halting automation. Manual intervention required.`);
      }
      finalStatus = 'AWAITING_APPROVAL'; // Breaks the loop and asks user
      mismatchDetected = false;          // We handled it via halt
    } else if (failureType === 'ENVIRONMENT_NONBLOCKING') {
      if (state.args && state.args.onStatus) {
        state.args.onStatus(`[${new Date().toLocaleTimeString()}] ⚠️ Non-Blocking Warning. Skipping and prioritizing main goal...`);
      }
      finalStatus = 'SUCCESS_NEXT_STEP'; // Skips the error, continues DAG execution
      mismatchDetected = false;          // Ignore the mismatch, do not replan
    }
  }

  // 3. Chunk Completion Validator
  const taskMem = state.taskMemory || {};
  const noPending = !taskMem.pending || taskMem.pending.length === 0;
  const noActive  = !taskMem.active  || taskMem.active.length === 0;

  let currentFailures = state.chunkFailures || 0;
  if (state.lastResult && state.lastResult.success === false) {
    currentFailures += 1;
  }

  if (
    noPending &&
    noActive &&
    state.currentPhase &&
    finalStatus !== 'REPLAN_NEEDED' &&
    finalStatus !== 'FAILED' &&
    finalStatus !== 'AWAITING_APPROVAL'
  ) {
    finalStatus = 'CHUNK_COMPLETE';
  }

  // 4. Execution Budget Updates
  let updatedBudget = { ...(state.executionBudget || {}) };
  if (state.action && state.action.tool) {
    updatedBudget.toolCalls = (updatedBudget.toolCalls || 0) + 1;
  }

  if (mismatchDetected) {
    if (state.args && state.args.onStatus) {
      state.args.onStatus(`[${new Date().toLocaleTimeString()}] ⚠️ Truth vs Belief Mismatch. Triggering Consistency Engine...`);
    }
    finalStatus = 'REPLAN_NEEDED';
  }

  return {
    truthState:      updatedTruth,
    beliefState:     updatedBelief,
    executionBudget: updatedBudget,
    status:          finalStatus,
    chunkFailures:   currentFailures,
  };
}

module.exports = { runVerifier };
