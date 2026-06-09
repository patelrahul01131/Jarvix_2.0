/**
 * Execution Validator
 * Acts as the anti-hallucination layer. Verifies that the tool output matches reality
 * before updating the TruthState.
 */

const fs = require('fs');
const path = require('path');

async function runValidator(state, args) {
  let truthState = { ...state.truthState };
  const lastResult = state.lastResult;
  const action = state.action;

  if (!lastResult || !action) {
    return truthState;
  }

  // Verify file operations
  if (action.tool === "fs.writeFile" || action.tool === "fs.editFile") {
    try {
      const fullPath = path.resolve(args.workspaceRoot, action.input.path);
      if (fs.existsSync(fullPath)) {
        // Truth: The file exists.
        if (!truthState.files) truthState.files = {};
        truthState.files[action.input.path] = {
          exists: true,
          lastModified: Date.now(),
          verified: true
        };
      } else {
        // Truth: The file does NOT exist, despite the tool execution.
        if (!truthState.files) truthState.files = {};
        truthState.files[action.input.path] = {
          exists: false,
          verified: false
        };
        // Override lastResult success since validation failed
        lastResult.success = false;
        lastResult.stderr = `Validation Error: File ${action.input.path} was expected to be written but does not exist.`;
      }
    } catch (e) {
      console.warn("[Validator] Failed to verify file state:", e.message);
    }
  }

  // Future verifications (e.g., shell.exec parsing for specific success strings) can go here

  return truthState;
}

module.exports = { runValidator };
