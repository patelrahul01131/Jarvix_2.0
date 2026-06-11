/**
 * Agent OS State Machine Definitions for Jarvix 3.0
 */

const STATES = {
  IDLE: "IDLE",
  INTENT: "INTENT",
  CONTEXT: "CONTEXT",
  WORKSPACE_GRAPH: "WORKSPACE_GRAPH",
  PLAN: "PLAN",
  VALIDATE: "VALIDATE",
  APPROVAL: "APPROVAL",
  EXECUTE: "EXECUTE",
  OBSERVE: "OBSERVE",
  REFLECT: "REFLECT",
  EVALUATE_GOAL: "EVALUATE_GOAL",
  REPLAN_DECISION: "REPLAN_DECISION",
  DONE: "DONE",
  ERROR: "ERROR",
};

const TRANSITIONS = {
  [STATES.IDLE]: { START: STATES.INTENT },
  [STATES.INTENT]: { NEXT: STATES.CONTEXT, FAST_CHAT: STATES.DONE },
  [STATES.CONTEXT]: { NEXT: STATES.WORKSPACE_GRAPH },
  [STATES.WORKSPACE_GRAPH]: { NEXT: STATES.PLAN },
  [STATES.PLAN]: { PLAN_READY: STATES.VALIDATE, FAILED: STATES.ERROR },
  [STATES.VALIDATE]: { VALID_PLAN: STATES.APPROVAL, INVALID_PLAN: STATES.PLAN },
  [STATES.APPROVAL]: { APPROVED: STATES.EXECUTE, REJECTED: STATES.PLAN, AWAITING_APPROVAL: STATES.IDLE },
  [STATES.EXECUTE]: { DONE: STATES.OBSERVE },
  [STATES.OBSERVE]: { DONE: STATES.REFLECT },
  [STATES.REFLECT]: { DONE: STATES.EVALUATE_GOAL },
  [STATES.EVALUATE_GOAL]: { DONE: STATES.REPLAN_DECISION },
  [STATES.REPLAN_DECISION]: { 
    CONTINUE: STATES.EXECUTE, // Continue to next step in queue
    RETRY: STATES.EXECUTE,    // Retry current step
    REPLAN: STATES.PLAN,      // Generate new plan
    ASK_USER: STATES.IDLE,    // Halt
    FINISH: STATES.DONE       // Goal satisfied
  },
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
