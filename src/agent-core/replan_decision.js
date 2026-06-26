/**
 * Replan Decision Node
 * Enforces the Execution Budget and determines the next state branch.
 */

const { goalManager } = require("./goal_manager");
const { lockManager } = require("./resource_lock_manager");

const EXECUTION_BUDGET = {
  maxSteps: 50,
  maxReplans: 5,
  maxRetries: 3,
  maxRepeatedFailures: 3,
  maxTokens: 100000,
};

async function runReplanDecision(state, args) {
  if (args && args.onStatus)
    args.onStatus(
      `[${new Date().toLocaleTimeString()}] 🚦 Evaluating Replan Decision...`,
    );

  const reflection = state.reflection || {};
  const decision = reflection.decision || "CONTINUE";

  // Initialize or increment budget trackers
  state.budget = state.budget || {
    steps: 0,
    replans: 0,
    retries: 0,
    repeatedFailures: 0,
    tokens: 0,
  };

  // Update budget based on decision
  if (decision === "REPLAN") {
    state.budget.replans += 1;
    state.budget.repeatedFailures += 1;
  } else if (decision === "RETRY") {
    state.budget.retries += 1;
    state.budget.repeatedFailures += 1;
  } else if (decision === "CONTINUE") {
    state.budget.steps += 1;
    state.budget.repeatedFailures = 0; // Reset consecutive failures on success
  }

  // Token tracking (assuming state.totalTokens is updated elsewhere)
  if (state.totalTokens) {
    state.budget.tokens = state.totalTokens;
  }

  // Enforce Execution Budget limits
  let budgetExceeded = false;
  let reason = "";

  if (state.budget.steps > EXECUTION_BUDGET.maxSteps) {
    budgetExceeded = true;
    reason = "Max execution steps exceeded.";
  } else if (state.budget.replans > EXECUTION_BUDGET.maxReplans) {
    budgetExceeded = true;
    reason = "Max replans exceeded. Agent is stuck.";
  } else if (state.budget.retries > EXECUTION_BUDGET.maxRetries) {
    budgetExceeded = true;
    reason = "Max retries exceeded.";
  } else if (
    state.budget.repeatedFailures >= EXECUTION_BUDGET.maxRepeatedFailures
  ) {
    budgetExceeded = true;
    reason = "Too many consecutive failures without progress.";
  } else if (state.budget.tokens > EXECUTION_BUDGET.maxTokens) {
    budgetExceeded = true;
    reason = "Max token budget exceeded.";
  }

  if (budgetExceeded) {
    console.warn(`[ExecutionBudget] Budget Exceeded: ${reason}`);
    if (args && args.onStatus)
      args.onStatus(`🛑 Execution paused: ${reason} Asking User...`);
    return {
      status: "ASK_USER",
      decisionOutput: {
        decision: "ASK_USER",
        reason: `Budget Exceeded: ${reason}`,
      },
    };
  }

  // Preserve status if it's already a terminating/checkpoint state
  if (state.status === "CHUNK_COMPLETE" || state.status === "DONE") {
    return { status: state.status, decisionOutput: reflection };
  }

  // Map reflection decision to next State Machine Node
  let nextStatus = "UNKNOWN";
  switch (decision) {
    case "CONTINUE":
      nextStatus = "PLAN"; // Go back to Planner to fetch next step
      break;
    case "RETRY":
      nextStatus = "EXECUTE"; // Retry current action
      break;
    case "REPLAN":
      nextStatus = "PLAN"; // Go back to Planner
      break;
    case "ASK_USER":
      nextStatus = "ASK_USER"; // Halt execution loop
      break;
    case "FINISH":
      nextStatus = "DONE"; // Goal satisfied
      if (args && args.sessionId) {
        const shortTerm = require("../memory/shortTerm");
        const session = shortTerm.getSession(args.sessionId);
        if (session && session.goalId) {
          goalManager.updateGoalStatus(session.goalId, "completed");
          lockManager.releaseLocksForGoal(session.goalId);
        }
      }
      break;
    default:
      nextStatus = "ASK_USER";
  }

  return {
    status: nextStatus,
    decisionOutput: reflection,
  };
}

module.exports = { runReplanDecision, EXECUTION_BUDGET };
