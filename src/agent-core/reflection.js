/**
 * Reflection & Fixer Node Module
 * Evaluates the outcome of an execution step and repairs broken plans.
 */
const { callLLM } = require("./llmClient");
const { FIXER_SYSTEM_PROMPT } = require("../rules/prompts");


async function runReflection(context, args, isPredictive = false) {
  if (isPredictive) {
    if (args && args.onStatus) args.onStatus("🤔 Performing predictive reflection...");
    // Predictive Reflection: Check if plan will fail before running
    const action = context.action;
    let likelyToFail = false;
    let reason = "";

    // Hardcoded predictive examples (in a real system, an LLM call goes here)
    if (action && action.tool === "shell.exec" && action.input.command.includes("npm run build")) {
      // e.g. We might check if node_modules exists, if not, predict failure.
      const fs = require('fs');
      const path = require('path');
      if (!fs.existsSync(path.join(args.workspaceRoot, "node_modules"))) {
        likelyToFail = true;
        reason = "node_modules missing. Plan must include npm install first.";
      }
    }

    if (likelyToFail) {
      console.warn(`[Predictive Reflection] Plan rejected: ${reason}`);
      return { success: false, replanNeeded: true, error: reason, status: "REJECTED_REPLAN" };
    }
    return { success: true, status: "APPROVED" };
  }

  // Reactive Reflection: Check execution results against belief state
  console.log(`[Reflection] Analyzing result of executed action`);
  const lastResult = context.lastResult;
  const truthState = context.truthState;

  // Compare truth vs belief
  let mismatchDetected = false;
  let correctionSignal = "";

  if (lastResult && !lastResult.success) {
    mismatchDetected = true;
    correctionSignal = lastResult.stderr || "Execution failed";
  }

  if (mismatchDetected) {
    console.warn(`[Reflection] Mismatch detected: ${correctionSignal}`);
    if (args && args.onStatus) args.onStatus("🛠️ Attempting to repair broken plan...");

    try {
      const messages = [
        {
          role: "user",
          content: `GOAL: ${context.goal}\n\nFAILED ACTION: ${JSON.stringify(context.action)}\n\nERROR TRACE:\n${correctionSignal}\n\nPlease provide a repaired JSON plan.`
        }
      ];

      const { reply } = await callLLM({
        messages,
        system: FIXER_SYSTEM_PROMPT,
        model: args.model,
        provider: args.provider,
        onChunk: null,
        signal: args.signal
      });

      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const repairedPlan = JSON.parse(jsonMatch[0]);
        if (repairedPlan.steps) {
          return { success: false, error: correctionSignal, replanNeeded: false, newPlan: repairedPlan.steps };
        }
      }
    } catch (e) {
      console.error("[Fixer] Failed to repair plan:", e);
    }
    
    return { success: false, error: correctionSignal, replanNeeded: true, status: "REPLAN_NEEDED" };
  }

  console.log(`[Reflection] Execution verified successfully.`);
  return { success: true, status: "SUCCESS_NEXT_STEP" };
}

// --- Phase 5: Failure Classification Layer ---
function classifyFailure(errorMessage) {
  const err = (errorMessage || "").toLowerCase();
  
  // ENVIRONMENT_BLOCKING: critical system issues preventing core OS execution
  if ((err.includes("not found") || err.includes("not recognized")) && (err.includes("npm") || err.includes("node") || err.includes("git") || err.includes("npx"))) {
    return "ENVIRONMENT_BLOCKING";
  }
  if (err.includes("permission denied") || err.includes("eacces") || err.includes("eperm")) {
    return "ENVIRONMENT_BLOCKING";
  }
  
  // ENVIRONMENT_NONBLOCKING: warnings, deprecations, slow network
  if (err.includes("warning") || err.includes("deprecated") || err.includes("notice")) {
    return "ENVIRONMENT_NONBLOCKING";
  }
  
  // TOOL_ERROR: syntax bugs, JS errors, standard tool crashes
  if (err.includes("syntaxerror") || err.includes("referenceerror") || err.includes("typeerror") || err.includes("failed to compile")) {
    return "TOOL_ERROR";
  }
  
  // Default fallback for any unclassified failure
  return "GOAL_CRITICAL";
}

module.exports = { runReflection, classifyFailure };
