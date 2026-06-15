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
    if (tool === "terminal.exec" && input.cmd === "mkdir" && input.args) {
      // Very rough simulation of mkdir to unblock subsequent writes into the new dir
      for (const arg of input.args) {
         if (!arg.startsWith("-")) simulatedFiles.add(path.resolve(args.workspaceRoot, input.cwd || ".", arg));
      }
    }

    // 1. Pre-flight checks for file existence
    if (tool === "fs.readFile" || tool === "fs.editFile" || tool === "fs.deleteFile" || tool === "fs.renameFile") {
      if (input.path) {
        const fullPath = path.resolve(args.workspaceRoot, input.path);
        if (!fs.existsSync(fullPath) && !simulatedFiles.has(fullPath)) {
          validationErrors.push(`Step ${i+1} (${tool}): Target file does not exist '${input.path}'`);
        }
      }
    }

    // 2. Validate target/replacement for fs.editFile
    if (tool === "fs.editFile" && input.path) {
      const fullPath = path.resolve(args.workspaceRoot, input.path);
      if (fs.existsSync(fullPath) && !simulatedFiles.has(fullPath)) {
        if (typeof input.target !== "string" || typeof input.replacement !== "string") {
          validationErrors.push(`Step ${i+1} (${tool}): 'target' and 'replacement' arguments must be strings`);
        } else {
          const originalCode = fs.readFileSync(fullPath, "utf-8");
          if (!originalCode.includes(input.target)) {
            validationErrors.push(
              `Step ${i+1} (${tool}): Target string not found in file '${input.path}'. Ensure it exactly matches existing code.`
            );
          }
        }
      }
    }
  }

  // 3. Prevent mixing file writes and terminal commands in the same plan
  const hasFileMod = steps.some(s => s.tool === "fs.writeFile" || s.tool === "fs.editFile");
  const hasTerminal = steps.some(s => s.tool === "terminal.exec");
  if (hasFileMod && hasTerminal) {
    validationErrors.push("Plan Rejected: You cannot schedule 'terminal.exec' in the same plan as 'fs.writeFile' or 'fs.editFile'. File modifications require asynchronous user approval before they exist on disk. Plan the file writes first, and wait for them to complete before running commands.");
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
