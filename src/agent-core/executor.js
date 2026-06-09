/**
 * Executor Module
 * Selects and runs tools based on the current plan step.
 */

const { TOOL_REGISTRY } = require("./toolRegistry");

async function runExecutor(step, context, args) {
  const { onChunk, onStatus } = args;

  const toolName = step.tool;
  const toolDefinition = TOOL_REGISTRY[toolName];

  // --- TOOL NORMALIZATION GUARD (SINGLE SOURCE OF TRUTH) ---
  if (!toolDefinition) {
    return {
      success: false,
      stdout: "",
      stderr: `TOOL_HALLUCINATION_ERROR: The requested tool '${toolName}' is not registered in TOOL_REGISTRY. You must only use listed tools.`,
      status: "REPLAN_NEEDED"
    };
  }

  // --- SCHEMA VALIDATOR ENGINE ---
  const input = step.input || {};
  if (toolDefinition.schema) {
    for (const key of Object.keys(toolDefinition.schema)) {
      if (toolDefinition.schema[key] === "string" && typeof input[key] !== "string") {
        return { success: false, stderr: `SCHEMA_ERROR: Tool '${toolName}' requires '${key}' to be a string.`, status: "REPLAN_NEEDED" };
      }
      if (toolDefinition.schema[key] === "array" && !Array.isArray(input[key])) {
        return { success: false, stderr: `SCHEMA_ERROR: Tool '${toolName}' requires '${key}' to be an array.`, status: "REPLAN_NEEDED" };
      }
    }
  }

  // --- POLICY ENGINE ---
  if (toolDefinition.risk === "high") {
    if (onStatus) onStatus(`⚠️ High-Risk Action Detected: ${toolName}. Proceeding with caution.`);
  }

  if (onStatus) onStatus(`⚙️ Executing Step: ${toolName}`);

  let executionOutput = "";

  try {
    if (toolName === "fs.writeFile") {
      // Use the provided Workspace API instead of blind fs writes
      if (!step.input || typeof step.input.path !== "string") {
        throw new Error(
          "Tool Execution Failed: 'path' argument must be a string.",
        );
      }

      const fs = require("fs");
      const path = require("path");

      let isNew = true;
      let originalCode = null;
      if (args.workspaceRoot) {
        const fullPath = path.resolve(args.workspaceRoot, step.input.path);
        const resolvedRoot = path.resolve(args.workspaceRoot);
        if (!fullPath.startsWith(resolvedRoot)) {
          throw new Error(
            "Security Violation: Cannot write files outside of the workspace directory.",
          );
        }
        isNew = !fs.existsSync(fullPath);
        if (!isNew) {
          originalCode = fs.readFileSync(fullPath, "utf-8");
        }
      }

      const content =
        step.input.content !== undefined ? step.input.content : "";

      if (args.proposeFileWrite) {
        // Execute via the virtual workspace layer
        args.proposeFileWrite({
          filePath: step.input.path,
          code: content,
          isNew: isNew,
          originalCode: originalCode,
        });
        executionOutput += `\nProposed file write: ${step.input.path}`;
      } else if (args.onFileWrite) {
        await args.onFileWrite({
          filePath: step.input.path,
          code: content,
          isNew: isNew,
        });
        executionOutput += `\nWrote file: ${step.input.path}`;
      } else {
        throw new Error(
          "Tool Execution Failed: No workspace file writer access.",
        );
      }
    } else if (toolName === "fs.editFile") {
      if (
        !step.input ||
        typeof step.input.path !== "string" ||
        typeof step.input.startLine !== "number" ||
        typeof step.input.endLine !== "number" ||
        typeof step.input.replace !== "string"
      ) {
        throw new Error(
          "Tool Execution Failed: 'path', 'startLine', 'endLine', and 'replace' arguments must be provided.",
        );
      }

      const fs = require("fs");
      const path = require("path");

      if (!args.workspaceRoot) {
        throw new Error("Tool Execution Failed: No workspace root access.");
      }

      const fullPath = path.resolve(args.workspaceRoot, step.input.path);
      const resolvedRoot = path.resolve(args.workspaceRoot);
      if (!fullPath.startsWith(resolvedRoot)) {
        throw new Error(
          "Security Violation: Cannot write files outside of the workspace directory.",
        );
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${step.input.path}`);
      }

      const originalCode = fs.readFileSync(fullPath, "utf-8");
      const lines = originalCode.split("\n");
      const startIdx = step.input.startLine - 1;
      const endIdx = step.input.endLine - 1;

      if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
        throw new Error(
          `Tool Execution Failed: Invalid line range ${step.input.startLine}-${step.input.endLine}. File has ${lines.length} lines.`,
        );
      }

      const content = [
        ...lines.slice(0, startIdx),
        step.input.replace,
        ...lines.slice(endIdx + 1),
      ].join("\n");

      if (args.proposeFileWrite) {
        args.proposeFileWrite({
          filePath: step.input.path,
          code: content,
          isNew: false,
          originalCode: originalCode,
        });
        executionOutput += `\nProposed file edit: ${step.input.path}`;
      } else if (args.onFileWrite) {
        await args.onFileWrite({
          filePath: step.input.path,
          code: content,
          isNew: false,
        });
        executionOutput += `\nEdited file: ${step.input.path}`;
      } else {
        throw new Error(
          "Tool Execution Failed: No workspace file writer access.",
        );
      }
    } else if (toolName === "fs.readFile") {
      const fs = require("fs");
      const path = require("path");

      if (!args.workspaceRoot) {
        throw new Error("Tool Execution Failed: No workspace root access.");
      }

      if (!step.input || typeof step.input.path !== "string") {
        throw new Error(
          "Tool Execution Failed: 'path' argument must be a string.",
        );
      }
      const fullPath = path.resolve(args.workspaceRoot, step.input.path);
      const resolvedRoot = path.resolve(args.workspaceRoot);
      if (!fullPath.startsWith(resolvedRoot)) {
        throw new Error(
          "Security Violation: Cannot read files outside of the workspace directory.",
        );
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found in workspace: ${step.input.path}`);
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      executionOutput += `\nRead file: ${step.input.path}\nContent:\n${content.substring(0, 1000)}${content.length > 1000 ? "\n... (truncated)" : ""}`;
    } else if (toolName === "terminal.exec") {
      if (!args.workspaceRoot) throw new Error("Tool Execution Failed: No workspace root access.");

      const cmd = step.input.cmd;
      const cmdArgs = step.input.args;

      if (!toolDefinition.allowedCommands.includes(cmd)) {
        throw new Error(`SECURITY_VIOLATION: Command '${cmd}' is not in the allowedCommands list for terminal.exec.`);
      }

      if (args.proposeTerminalCommand) {
        args.proposeTerminalCommand({ command: `${cmd} ${cmdArgs.join(" ")}` });
        executionOutput += `\nProposed terminal command: ${cmd} ${cmdArgs.join(" ")}`;
      } else {
        const { spawn } = require("child_process");
        const isWin = process.platform === "win32";
        
        let actualCmd = cmd;
        if (isWin && cmd === "npm") actualCmd = "npm.cmd";
        if (isWin && cmd === "npx") actualCmd = "npx.cmd";

        executionOutput += `\nExecuting tokenized command: ${cmd} ${JSON.stringify(cmdArgs)}`;
        
        await new Promise((resolve, reject) => {
          const child = spawn(actualCmd, cmdArgs, {
            cwd: args.workspaceRoot,
            shell: false, // EXPLICITLY DISABLED FOR SECURITY
          });

          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (data) => stdout += data.toString());
          child.stderr.on("data", (data) => stderr += data.toString());

          child.on("close", (code) => {
            executionOutput += `\nOutput: ${stdout}\n${stderr}`;
            if (code !== 0) {
               reject(new Error(`Command exited with code ${code}.\nStderr: ${stderr}\nStdout: ${stdout}`));
            } else {
               resolve();
            }
          });
          
          child.on("error", (err) => {
            reject(new Error(`Spawn failed: ${err.message}`));
          });
        });
      }
    } else if (toolName === "list_dir") {
      const fs = require("fs");
      const path = require("path");
      if (!args.workspaceRoot)
        throw new Error("Tool Execution Failed: No workspace root access.");

      const fullPath = path.resolve(args.workspaceRoot, step.input.path || "");
      if (!fullPath.startsWith(path.resolve(args.workspaceRoot)))
        throw new Error("Security Violation.");
      if (!fs.existsSync(fullPath))
        throw new Error(`Directory not found: ${step.input.path}`);

      const items = fs.readdirSync(fullPath);
      executionOutput += `\nContents of ${step.input.path || "."}:\n${items.join("\n")}`;
    } else if (toolName === "grep_search") {
      const { exec } = require("child_process");
      const util = require("util");
      const execAsync = util.promisify(exec);
      if (!args.workspaceRoot)
        throw new Error("Tool Execution Failed: No workspace root access.");
      try {
        const cmd =
          process.platform === "win32"
            ? `findstr /s /i "${step.input.pattern}" "${path.join(step.input.path || ".", "*")}"`
            : `grep -rnw "${step.input.path || "."}" -e "${step.input.pattern}"`;
        const { stdout } = await execAsync(cmd, {
          cwd: args.workspaceRoot,
          encoding: "utf-8",
        });
        executionOutput += `\nSearch results:\n${stdout.substring(0, 1000)}`;
      } catch (e) {
        throw new Error("Search failed or no matches found.");
      }
    } else if (toolName === "response") {
      if (onChunk) onChunk(`\n${step.input.message}\n\n`);
      executionOutput += `\nResponded to user.`;
    }

    return {
      success: true,
      stdout: executionOutput,
      stderr: "",
    };
  } catch (err) {
    console.error("[Executor] Execution failed:", err.message);
    // Suppress raw error leaks to the UI; it will be handled by Fixer Node or Status Panel
    return {
      success: false,
      stdout: "",
      stderr: err.message,
    };
  }
}

module.exports = { runExecutor };
