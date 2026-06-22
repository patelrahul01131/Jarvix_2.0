/**
 * Context Manager
 * Handles lazy-loading of context to prevent "Needle in a Haystack" issues.
 */

const { TOOL_REGISTRY } = require("./toolRegistry");

function buildMinimalContext(state) {
  // Extract just the available tool schemas and risk profiles
  const availableTools = Object.keys(TOOL_REGISTRY).reduce((acc, key) => {
    acc[key] = {
      description: TOOL_REGISTRY[key].description,
      schema: TOOL_REGISTRY[key].schema,
      risk: TOOL_REGISTRY[key].risk
    };
    return acc;
  }, {});

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
    availableTools: availableTools
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
