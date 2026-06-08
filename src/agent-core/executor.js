/**
 * Executor Module
 * Selects and runs tools based on the current plan step.
 */

async function runExecutor(step, context, args) {
  const { onChunk, onStatus } = args;

  if (onStatus) onStatus(`⚙️ Executing Step: ${step.action}`);

  let executionOutput = "";

  try {
    if (step.tool === "fs.writeFile") {
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
    } else if (step.tool === "fs.editFile") {
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
    } else if (step.tool === "fs.readFile") {
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
    } else if (step.tool === "shell.exec") {
      if (!args.workspaceRoot) {
        throw new Error("Tool Execution Failed: No workspace root access.");
      }

      if (args.proposeTerminalCommand) {
        args.proposeTerminalCommand({ command: step.input.command });
        executionOutput += `\nProposed terminal command: ${step.input.command}`;
      } else {
        const { exec } = require("child_process");
        const util = require("util");
        const execAsync = util.promisify(exec);
        try {
          const { stdout, stderr } = await execAsync(step.input.command, {
            cwd: args.workspaceRoot,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024 * 10,
          });
          executionOutput += `\nCommand executed: ${step.input.command}\nOutput: ${stdout}\n${stderr}`;
        } catch (cmdErr) {
          throw new Error(
            `Command failed: ${cmdErr.message}\nStderr: ${cmdErr.stderr || ""}\nStdout: ${cmdErr.stdout || ""}`,
          );
        }
      }
    } else if (step.tool === "list_dir") {
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
    } else if (step.tool === "grep_search") {
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
        executionOutput += `\nSearch Results:\n${stdout}`;
      } catch (e) {
        executionOutput += `\nSearch Results: No matches found or error (${e.message}).`;
      }
    } else if (step.tool === "response") {
      if (onChunk) onChunk(`\n${step.input.message}\n\n`);
      executionOutput += `\nResponded to user.`;
    } else {
      console.warn(`[Executor] Unknown tool: ${step.tool}`);
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
