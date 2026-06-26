/**
 * Agent OS State Machine Definitions for Jarvix 3.0
 */

const STATES = {
  IDLE:           'IDLE',
  CLASSIFYING:    'CLASSIFYING',    // Intent Router running
  EXTRACTING:     'EXTRACTING',     // Goal Extractor running
  PLANNING:       'PLANNING',       // Planner generating steps
  VALIDATING:     'VALIDATING',     // Execution Validator checking plan
  AWAITING:       'AWAITING',       // Waiting for user approval
  EXECUTING:      'EXECUTING',      // Executor running a tool
  OBSERVING:      'OBSERVING',      // Observation Store recording facts
  VERIFYING:      'VERIFYING',      // Verifier checking result
  REFLECTING:     'REFLECTING',     // Reflection Node analyzing
  EVALUATING:     'EVALUATING',     // Goal Evaluator checking completion
  REPLANNING:     'REPLANNING',     // Generating new plan after failure
  COMPACTING:     'COMPACTING',     // Context compaction running
  COMPLETED:      'COMPLETED',
  FAILED:         'FAILED',
};

const TRANSITIONS = {
  [STATES.IDLE]:        { START: STATES.CLASSIFYING },
  [STATES.CLASSIFYING]: { CHAT: STATES.COMPLETED, TASK: STATES.EXTRACTING },
  [STATES.EXTRACTING]:  { NEXT: STATES.PLANNING },
  [STATES.PLANNING]:    { PLAN_READY: STATES.VALIDATING, ERROR: STATES.FAILED },
  [STATES.VALIDATING]:  { VALID: STATES.AWAITING, INVALID: STATES.PLANNING },
  [STATES.AWAITING]:    { APPROVED: STATES.EXECUTING, REJECTED: STATES.PLANNING, ABORT: STATES.IDLE },
  [STATES.EXECUTING]:   { DONE: STATES.OBSERVING, ERROR: STATES.REPLANNING },
  [STATES.OBSERVING]:   { NEXT: STATES.VERIFYING },
  [STATES.VERIFYING]:   { NEXT: STATES.REFLECTING },
  [STATES.REFLECTING]:  { NEXT: STATES.EVALUATING },
  [STATES.EVALUATING]:  { CONTINUE: STATES.EXECUTING, FINISH: STATES.COMPACTING },
  [STATES.REPLANNING]:  { PLAN_READY: STATES.VALIDATING, FAIL: STATES.FAILED },
  [STATES.COMPACTING]:  { DONE: STATES.COMPLETED }
};

function transition(currentState, action) {
  const nextState = TRANSITIONS[currentState]?.[action];
  if (!nextState) {
    console.warn(`[Agent OS] Invalid transition from ${currentState} via ${action}`);
    return currentState;
  }
  console.log(`[Agent OS] State transition: ${currentState} --(${action})--> ${nextState}`);
  return nextState;
}

module.exports = { STATES, transition };
