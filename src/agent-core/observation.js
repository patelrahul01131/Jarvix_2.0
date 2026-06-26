/**
 * Observation Node
 * Normalizes raw tool execution output into deterministic structured data
 * before it reaches the Reflection layer. Extracts facts for the Observation Store.
 */

const { observationStore } = require('./observation_store');

function extractFacts(obs, state) {
  const facts = [];
  const actionInput = state.action?.input || {};
  
  if (obs.tool === "fs.writeFile" && obs.success) {
    facts.push({ source: obs.tool, tool: obs.tool, fact: `File created: ${obs.filesCreated[0]}`, value: true, confidence: 1.0 });
  } else if (obs.tool === "fs.editFile" && obs.success) {
    facts.push({ source: obs.tool, tool: obs.tool, fact: `File modified: ${obs.filesModified[0]}`, value: true, confidence: 1.0 });
  } else if (obs.tool === "fs.readFile" && obs.success) {
    facts.push({ source: obs.tool, tool: obs.tool, fact: `Read file: ${actionInput.path}`, value: true, confidence: 1.0 });
  } else if (obs.tool === "grep_search" && obs.success) {
    const hasResults = obs.stdout && obs.stdout.trim().length > 0 && !obs.stdout.includes("0 results");
    facts.push({ 
      source: obs.tool, 
      tool: obs.tool, 
      fact: `grep search for '${actionInput.query}' in ${actionInput.SearchPath}`, 
      value: hasResults, 
      confidence: 0.95 
    });
  } else if (obs.tool === "terminal.exec" && obs.success) {
    facts.push({ source: obs.tool, tool: obs.tool, fact: `Command succeeded: ${actionInput.cmd}`, value: true, confidence: 0.9 });
  } else if (obs.tool === "terminal.exec" && !obs.success) {
    facts.push({ source: obs.tool, tool: obs.tool, fact: `Command failed: ${actionInput.cmd}`, value: false, confidence: 0.9 });
  }

  return facts;
}

function buildObservation(state, execRes) {
  const tool = state.action ? (state.action.tool || state.action.skill) : "unknown";
  
  // Basic deterministic observation structure
  const observation = {
    tool: tool,
    exitCode: execRes.exitCode !== undefined ? execRes.exitCode : (execRes.success === false ? 1 : 0),
    stdout: execRes.stdout || "",
    stderr: execRes.stderr || "",
    durationMs: execRes.durationMs || 0,
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    processStarted: null,
    success: execRes.success !== false
  };

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

  // ─── Extract and persist facts ────────────────────────────────────────────
  const facts = extractFacts(observation, state);
  for (const f of facts) {
    observationStore.record(args.sessionId, f);
  }
  // ──────────────────────────────────────────────────────────────────────────

  return {
    structuredObservation: observation,
    recentMessages: [...(state.recentMessages || []), observationLog].slice(-50)
  };
}

module.exports = { runObservation, buildObservation };
