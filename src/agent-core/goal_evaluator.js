/**
 * Goal Evaluator Node
 * Evaluates the current state against the success criteria defined by the planner.
 * Focuses on outcomes rather than execution steps.
 */

const fs = require('fs');
const path = require('path');

async function evaluateGoal(state, args) {
  if (args.onStatus) {
    args.onStatus(`[${new Date().toLocaleTimeString()}] 🎯 Evaluating goal state...`);
  }

  const currentGoal = state.currentIntent?.activeGoal;
  if (!currentGoal || !currentGoal.successCriteria || !currentGoal.verificationMethods) {
    // If no explicit goal criteria exists, we assume the chunk is not finished
    // or we rely on the old pending steps logic. For 3.0, we just pass through.
    return { status: state.status };
  }

  let allSatisfied = true;
  let evaluationLogs = [];

  for (const verifier of currentGoal.verificationMethods) {
    let satisfied = false;
    let reason = "Unknown";

    try {
      if (verifier.verification.includes("exists")) {
        const targetMatch = verifier.verification.match(/([^ ]+) exists/);
        if (targetMatch && targetMatch[1]) {
          const target = targetMatch[1];
          const fullPath = path.resolve(args.workspaceRoot, target);
          if (fs.existsSync(fullPath)) {
            satisfied = true;
            reason = "File/Directory found";
          } else {
            reason = `Path not found: ${target}`;
          }
        }
      } else if (verifier.verification.includes("successful")) {
         // Check recent observations or episodic memory for success of a specific tool
         const targetMatch = verifier.verification.match(/([^ ]+) successful/);
         if (targetMatch && targetMatch[1]) {
            const toolName = targetMatch[1];
            // Simplistic check: look at lastResult or recent history
            if (state.structuredObservation && state.structuredObservation.success) {
                satisfied = true;
                reason = "Observation reports success";
            } else {
                reason = "Observation does not indicate success";
            }
         }
      }
      // Add more deterministic verification rules as needed
    } catch (err) {
      reason = `Evaluation error: ${err.message}`;
    }

    evaluationLogs.push(`Criterion: '${verifier.criterion}' -> ${satisfied ? '✅ PASS' : '❌ FAIL'} (${reason})`);
    if (!satisfied) allSatisfied = false;
  }

  if (args.onStatus) {
    args.onStatus(`[${new Date().toLocaleTimeString()}] 📊 Goal Evaluation: ${allSatisfied ? 'SATISFIED' : 'PENDING'}`);
  }

  return {
    goalEvaluationLogs: evaluationLogs,
    status: allSatisfied ? "CHUNK_COMPLETE" : state.status // If all satisfied, chunk is done. Otherwise, keep current status.
  };
}

module.exports = { evaluateGoal };
