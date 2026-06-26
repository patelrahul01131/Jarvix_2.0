/**
 * Context Manager
 * Handles lazy-loading of context to prevent "Needle in a Haystack" issues.
 */

const { buildThinkerContext, buildToolContext } = require("./context_builder");

// Legacy sync shim for backwards compatibility where needed
function buildMinimalContext(state) {
  // Extract just the available tool schemas and risk profiles
  const availableTools = buildToolContext();

  // Extract recent action history
  let lastActions = [];
  if (state.recentMessages && state.recentMessages.length > 0) {
    // Take the last 10 messages for a short term memory window
    lastActions = state.recentMessages.slice(-10);
  }

  return {
    goal: state.goal,
    currentIntent: state.currentIntent,
    lastActions: lastActions,
    availableTools: availableTools,
    relevantMemory: state.relevantMemory || null
  };
}

function buildErrorContext(state) {
  if (!state.lastResult || state.lastResult.success !== false) {
    return {};
  }
  
  return {
    error: state.lastResult.stderr || state.lastResult.error,
    failedTool: state.action ? state.action.tool : "unknown"
  };
}

module.exports = {
  buildMinimalContext,
  buildErrorContext
};
