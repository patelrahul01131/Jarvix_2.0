/**
 * Observation Node
 * Normalizes raw tool execution output into deterministic structured data
 * before it reaches the Reflection layer.
 */

function buildObservation(state, execRes) {
  const tool = state.action ? state.action.tool : "unknown";
  
  // Basic deterministic observation structure
  const observation = {
    tool: tool,
    exitCode: undefined,
    stdout: execRes.stdout || "",
    stderr: execRes.stderr || "",
    durationMs: execRes.durationMs || 0,
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    processStarted: null,
    success: execRes.success !== false
  };

  // Enhance observation based on specific tool outputs
  if (tool === "shell.exec" || tool === "terminal.exec") {
    // If the executor provides an explicit exit code, use it.
    // Otherwise, try to infer it from the success flag or stderr presence.
    if (execRes.exitCode !== undefined) {
      observation.exitCode = execRes.exitCode;
    } else {
      observation.exitCode = execRes.success === false ? 1 : 0;
    }
  }

  if (tool === "fs.writeFile" && execRes.success !== false) {
    observation.filesCreated.push(state.action.input?.path);
  }

  if (tool === "fs.editFile" && execRes.success !== false) {
    observation.filesModified.push(state.action.input?.path);
  }

  return observation;
}

async function runObservation(state, args) {
  if (args.onStatus) {
    args.onStatus(`[${new Date().toLocaleTimeString()}] 👁️ Observing results...`);
  }

  const observation = buildObservation(state, state.lastResult || {});

  // Append observation to execution logs / context
  const observationLog = `system: [OBSERVATION] Tool: ${observation.tool} | Success: ${observation.success} | ExitCode: ${observation.exitCode}\nStdout: ${observation.stdout.substring(0, 500)}\nStderr: ${observation.stderr.substring(0, 500)}`;

  let sess = require("../memory/shortTerm").getSession(args.sessionId);
  if (sess) {
    sess.messages.push({ role: "system", content: observationLog });
    require("../memory/shortTerm").saveSession(args.sessionId, sess);
  }

  return {
    structuredObservation: observation,
    recentMessages: [...(state.recentMessages || []), observationLog].slice(-50)
  };
}

module.exports = { runObservation, buildObservation };
