/**
 * Reflection Node
 * Evaluates structured observations deterministically and makes branching decisions.
 */
const { callLLM } = require("./llmClient");
const { memoryManager } = require("../memory/memory_manager");
const { eventBus, EVENTS } = require("../core/event_bus");

async function runReflection(state, args) {
  if (args && args.onStatus) args.onStatus(`[${new Date().toLocaleTimeString()}] 🤔 Reflecting on execution outcome...`);

  const obs = state.structuredObservation || {};
  const action = state.action || {};
  let decision = "CONTINUE";
  let reason = "Execution successful";

  // 0. Intercept Patch Rejections (Human-in-the-loop feedback)
  if (obs.event === "PATCH_REJECTED") {
    const feedback = obs.reason || "User rejected without specific reason.";
    
    // Store in failure memory for next iteration
    eventBus.emitEvent(EVENTS.FAILURE_RECORDED, {
      timestamp: new Date().toISOString(),
      failure: { 
        tool: action.tool, 
        error: "User rejected proposed diff.", 
        rootCause: feedback,
        resolution: "Replan considering user feedback." 
      }
    });

    return { 
      reflection: { 
        decision: "REPLAN", 
        reason: "USER_REJECTED_PATCH", 
        details: `The user rejected the patch. Reason given: ${feedback}` 
      }, 
      status: "DONE" 
    };
  }

  // 1. Tool Capability Mismatch Detector
  const errorText = (obs.stderr || "") + (state.lastResult?.error || "");
  const errLowerText = errorText.toLowerCase();
  if (errLowerText.includes("allowedcommands") || errLowerText.includes("security_violation") || errLowerText.includes("security violation")) {
    return { 
       reflection: { decision: "REPLAN", reason: "TOOL_CAPABILITY_MISMATCH", details: "Planner attempted to use an unapproved command or tool context." },
       status: "DONE" 
    };
  }

  // 1.5 Deterministic Validation Failure
  if (errorText.includes("Pre-execution validation failed")) {
    return {
       reflection: { decision: "REPLAN", reason: "VALIDATION_FAILED", details: "Plan failed schema/execution validation. Must fix the plan schema." },
       status: "DONE"
    };
  }

  // 2. Deterministic Execution Rules
  if (obs.exitCode === 0 && obs.success !== false) {
    if (action.tool === "fs.readFile" || action.tool === "fs.writeFile" || action.tool === "fs.editFile") {
      memoryManager.updateBelief(
        `file_state:${action.input.path}`, 
        "verified_exists", 
        1.0, 
        `Successfully executed ${action.tool}`
      );
    }
    return { reflection: { decision: "CONTINUE", reason: "exitCode === 0" }, status: "DONE" };
  }

  const errLower = errorText.toLowerCase();

  // Emit failure to memory subsystem
  eventBus.emitEvent(EVENTS.FAILURE_RECORDED, {
    timestamp: new Date().toISOString(),
    failure: { tool: action.tool, error: errorText }
  });

  // Retryable errors
  if (errLower.includes("429") || errLower.includes("rate limit") || errLower.includes("etimedout") || errLower.includes("econnrefused")) {
    return { reflection: { decision: "RETRY", reason: "NETWORK_OR_RATE_LIMIT" }, status: "DONE" };
  }

  // Replan errors (fixable by different approach)
  if (errLower.includes("enoent") || errLower.includes("no such file") || errLower.includes("directory not found") || errLower.includes("file not found")) {
    return { reflection: { decision: "REPLAN", reason: "PATH_MISSING" }, status: "DONE" };
  }
  
  if (errLower.includes("command not found") || errLower.includes("not recognized") || errLower.includes("is not recognized as an internal or external command")) {
    return { reflection: { decision: "REPLAN", reason: "DEPENDENCY_MISSING" }, status: "DONE" };
  }

  // Halt errors
  if (errLower.includes("eperm") || errLower.includes("eacces") || errLower.includes("permission denied")) {
    return { reflection: { decision: "ASK_USER", reason: "PERMISSION_DENIED" }, status: "DONE" };
  }

  // Edge cases
  if (errLower.includes("already in use") || errLower.includes("eaddrinuse")) {
    return { reflection: { decision: "CONTINUE", reason: "PROCESS_ALREADY_RUNNING" }, status: "DONE" };
  }

  // 3. Fallback LLM Reflection for unknown/complex errors
  if (obs.success === false || obs.exitCode !== 0) {
    if (args && args.onStatus) args.onStatus(`[${new Date().toLocaleTimeString()}] 🧠 Analyzing complex error...`);
    try {
      const messages = [{
        role: "user",
        content: `ACTION: ${JSON.stringify(action)}\n\nOBSERVATION: ${JSON.stringify(obs)}\n\nDetermine the next step: CONTINUE, RETRY, REPLAN, or ASK_USER. Output strictly JSON: {"decision": "...", "reason": "..."}. Escape all newlines in strings as \\n.`
      }];
      
      const { reply } = await callLLM({
        messages,
        system: "You are a reflection engine. Output strictly valid JSON. Escape all newlines in strings as \\n. Example: {\"decision\": \"REPLAN\", \"reason\": \"Syntax error on line 42\"}",
        model: args.model,
        provider: args.provider,
        onChunk: null,
        signal: args.signal
      });

      let cleanJson = reply.trim();
      let startIndex = cleanJson.indexOf('{');
      if (startIndex !== -1) {
        let braceCount = 0;
        let endIndex = -1;
        for (let i = startIndex; i < cleanJson.length; i++) {
          if (cleanJson[i] === '{') braceCount++;
          else if (cleanJson[i] === '}') braceCount--;
          
          if (braceCount === 0) {
            endIndex = i;
            break;
          }
        }
        if (endIndex !== -1) {
          cleanJson = cleanJson.substring(startIndex, endIndex + 1);
          const parsed = JSON.parse(cleanJson);
          if (["CONTINUE", "RETRY", "REPLAN", "ASK_USER"].includes(parsed.decision)) {
             return { reflection: parsed, status: "DONE" };
          }
        }
      }
    } catch (e) {
      console.warn("[Reflection] LLM Fallback failed:", e.message);
    }
    
    // Ultimate fallback if parsing fails
    return { reflection: { decision: "ASK_USER", reason: "UNKNOWN_ERROR_LLM_FAILED" }, status: "DONE" };
  }

  return { reflection: { decision: "CONTINUE", reason: "Execution successful (fallback)" }, status: "DONE" };
}

// --- Phase 5: Failure Classification Layer (Preserved for backwards compatibility) ---
function classifyFailure(errorMessage) {
  const err = (errorMessage || "").toLowerCase();
  if ((err.includes("not found") || err.includes("not recognized")) && (err.includes("npm") || err.includes("node") || err.includes("git") || err.includes("npx"))) {
    return "ENVIRONMENT_BLOCKING";
  }
  if (err.includes("permission denied") || err.includes("eacces") || err.includes("eperm")) {
    return "ENVIRONMENT_BLOCKING";
  }
  if (err.includes("warning") || err.includes("deprecated") || err.includes("notice")) {
    return "ENVIRONMENT_NONBLOCKING";
  }
  if (err.includes("syntaxerror") || err.includes("referenceerror") || err.includes("typeerror") || err.includes("failed to compile")) {
    return "TOOL_ERROR";
  }
  return "GOAL_CRITICAL";
}

module.exports = { runReflection, classifyFailure };
