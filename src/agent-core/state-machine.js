/**
 * Agent OS State Machine Definitions.
 */

const STATES = {
  IDLE: "IDLE",
  INTENT_GATE: "INTENT_GATE",
  CHAT: "CHAT",
  PLAN: "PLAN",
  EXECUTE: "EXECUTE",
  OBSERVE: "OBSERVE",
  REFLECT: "REFLECT",
  DONE: "DONE",
  ERROR: "ERROR",
};

const TRANSITIONS = {
  [STATES.IDLE]: { START: STATES.INTENT_GATE },
  [STATES.INTENT_GATE]: { IS_CHAT: STATES.CHAT, IS_CODE: STATES.PLAN },
  [STATES.CHAT]: { DONE: STATES.DONE, FAILED: STATES.ERROR },
  [STATES.PLAN]: { PLAN_READY: STATES.EXECUTE, FAILED: STATES.ERROR },
  [STATES.EXECUTE]: { EXECUTION_DONE: STATES.OBSERVE, EXECUTION_FAILED: STATES.REFLECT },
  [STATES.OBSERVE]: { OBSERVED: STATES.REFLECT },
  [STATES.REFLECT]: { 
    SUCCESS_NEXT_STEP: STATES.EXECUTE, 
    SUCCESS_FINISHED: STATES.DONE, 
    REPLAN_NEEDED: STATES.PLAN,
    GIVE_UP: STATES.ERROR
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
