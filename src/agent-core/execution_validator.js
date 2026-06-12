/**
 * Validation Node
 * Pre-execution validation. Catches obvious errors or tool misuses
 * in the generated plan BEFORE asking the user for approval.
 */
const fs = require('fs');
const path = require('path');

async function runValidator(state, args) {
  if (args && args.onStatus) args.onStatus(`[${new Date().toLocaleTimeString()}] 🛡️ Validating Execution Plan...`);

  const plan = state.action || {};
  const steps = plan.executionPlan || [];
  let validationErrors = [];

  // Track files created within the plan to avoid false positives in validation
  const simulatedFiles = new Set();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tool = step.tool;
    const input = step.input || {};

    if (tool === "fs.writeFile" && input.path) {
      simulatedFiles.add(path.resolve(args.workspaceRoot, input.path));
    }

    // 1. Pre-flight checks for file existence
    if (tool === "fs.readFile" || tool === "fs.editFile" || tool === "fs.deleteFile") {
      if (input.path) {
        const fullPath = path.resolve(args.workspaceRoot, input.path);
        if (!fs.existsSync(fullPath) && !simulatedFiles.has(fullPath)) {
          validationErrors.push(`Step ${i+1} (${tool}): Target file does not exist '${input.path}'`);
        }
      }
    }

    // 2. Validate line ranges for fs.editFile
    if (tool === "fs.editFile" && input.path) {
      const fullPath = path.resolve(args.workspaceRoot, input.path);
      if (fs.existsSync(fullPath) && !simulatedFiles.has(fullPath)) {
        if (typeof input.startLine !== "number" || typeof input.endLine !== "number") {
          validationErrors.push(`Step ${i+1} (${tool}): 'startLine' and 'endLine' arguments must be numbers`);
        } else {
          const originalCode = fs.readFileSync(fullPath, "utf-8");
          const lines = originalCode.split("\n");
          const startIdx = input.startLine - 1;
          const endIdx = input.endLine - 1;
          if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
            validationErrors.push(
              `Step ${i+1} (${tool}): Invalid line range ${input.startLine}-${input.endLine}. File '${input.path}' has ${lines.length} lines.`
            );
          }
        }
      }
    }
  }

  if (validationErrors.length > 0) {
    console.warn("[ValidationNode] Plan rejected:", validationErrors);
    
    // Create a fake observation so the Reflection node can process it naturally
    const fakeObservation = {
      tool: "ValidationNode",
      success: false,
      exitCode: 1,
      stderr: `Pre-execution validation failed:\n` + validationErrors.join("\n")
    };

    return {
      status: "INVALID_PLAN",
      structuredObservation: fakeObservation,
      lastResult: { success: false, error: fakeObservation.stderr }
    };
  }

  return {
    status: "VALID_PLAN"
  };
}

module.exports = { runValidator };
