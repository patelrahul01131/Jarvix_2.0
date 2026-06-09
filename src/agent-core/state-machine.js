/**
 * Agent OS State Machine Definitions.
 */

const STATES = {
  IDLE: "IDLE",
  INTENT_GATE: "INTENT_GATE",
  CHAT: "CHAT",
  PLAN: "PLAN",
  PREDICTIVE_REFLECT: "PREDICTIVE_REFLECT",
  EXECUTE: "EXECUTE",
  VALIDATE: "VALIDATE",
  OBSERVE: "OBSERVE",
  REFLECT: "REFLECT",
  DONE: "DONE",
  ERROR: "ERROR",
};

const TRANSITIONS = {
  [STATES.IDLE]: { START: STATES.INTENT_GATE },
  [STATES.INTENT_GATE]: { IS_CHAT: STATES.CHAT, IS_CODE: STATES.PLAN },
  [STATES.CHAT]: { DONE: STATES.DONE, FAILED: STATES.ERROR },
  [STATES.PLAN]: { PLAN_READY: STATES.PREDICTIVE_REFLECT, FAILED: STATES.ERROR },
  [STATES.PREDICTIVE_REFLECT]: { APPROVED: STATES.EXECUTE, REJECTED_REPLAN: STATES.PLAN },
  [STATES.EXECUTE]: { EXECUTION_DONE: STATES.VALIDATE, EXECUTION_FAILED: STATES.REFLECT },
  [STATES.VALIDATE]: { VALIDATED: STATES.OBSERVE },
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
