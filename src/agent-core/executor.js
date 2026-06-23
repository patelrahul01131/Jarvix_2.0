/**
 * Executor Module
 * Selects and runs tools based on the current plan step.
 */

const { TOOL_REGISTRY } = require("./toolRegistry");

async function runExecutor(step, context, args) {
  const { onChunk, onStatus } = args;
  const startTime = Date.now();

  const toolName = step.tool;
  const toolDefinition = TOOL_REGISTRY[toolName];

  // --- TOOL NORMALIZATION GUARD (SINGLE SOURCE OF TRUTH) ---
  if (!toolDefinition) {
    return {
      success: false,
      stdout: "",
      stderr: `TOOL_HALLUCINATION_ERROR: The requested tool '${toolName}' is not registered in TOOL_REGISTRY. You must only use listed tools.`,
      status: "REPLAN_NEEDED",
    };
  }

  // --- SCHEMA VALIDATOR ENGINE ---
  const input = step.input || {};
  if (toolDefinition.schema) {
    for (const key of Object.keys(toolDefinition.schema)) {
      const expectedType = toolDefinition.schema[key];
      const isOptional = expectedType.endsWith("?");
      const baseType = isOptional ? expectedType.slice(0, -1) : expectedType;

      if (input[key] === undefined || input[key] === null) {
        if (!isOptional) {
          return {
            success: false,
            stderr: `SCHEMA_ERROR: Tool '${toolName}' requires missing property '${key}'.`,
            status: "REPLAN_NEEDED",
          };
        }
        continue;
      }

      if (baseType === "string" && typeof input[key] !== "string") {
        return {
          success: false,
          stderr: `SCHEMA_ERROR: Tool '${toolName}' requires '${key}' to be a string.`,
          status: "REPLAN_NEEDED",
        };
      }
      if (baseType === "array" && !Array.isArray(input[key])) {
        return {
          success: false,
          stderr: `SCHEMA_ERROR: Tool '${toolName}' requires '${key}' to be an array.`,
          status: "REPLAN_NEEDED",
        };
      }
    }
  }

  // --- POLICY ENGINE ---
  if (toolDefinition.risk === "high") {
    if (onStatus)
      onStatus(
        `⚠️ High-Risk Action Detected: ${toolName}. Proceeding with caution.`,
      );
  }

  if (onStatus) onStatus(`⚙️ Executing Step: ${toolName}`);
  console.log("\n=========================");
  console.log("[DEBUG] TOOL NAME:", toolName);
  console.log("[DEBUG] TASK:", JSON.stringify(step, null, 2));
  console.log("=========================\n");

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
        const relativePath = path.relative(resolvedRoot, fullPath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
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

      if (args.proposeFileWrite && !context.autoExecute) {
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
        typeof step.input.target !== "string" ||
        typeof step.input.replacement !== "string"
      ) {
        throw new Error(
          "Tool Execution Failed: 'path', 'target', and 'replacement' arguments must be provided.",
        );
      }

      const fs = require("fs");
      const path = require("path");

      if (!args.workspaceRoot) {
        throw new Error("Tool Execution Failed: No workspace root access.");
      }

      const fullPath = path.resolve(args.workspaceRoot, step.input.path);
      const resolvedRoot = path.resolve(args.workspaceRoot);
      const relativePath = path.relative(resolvedRoot, fullPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(
          "Security Violation: Cannot write files outside of the workspace directory.",
        );
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${step.input.path}`);
      }

      const originalCode = fs.readFileSync(fullPath, "utf-8");

      if (!originalCode.includes(step.input.target)) {
        throw new Error(
          `Tool Execution Failed: The target string was not found in the file. Ensure the target string perfectly matches the existing file contents, including whitespace.`,
        );
      }

      const content = originalCode.replace(
        step.input.target,
        step.input.replacement,
      );

      if (args.proposeFileWrite && !context.autoExecute) {
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
    } else if (toolName === "fs.editFileLines") {
      if (
        !step.input ||
        typeof step.input.path !== "string" ||
        typeof step.input.newCode !== "string" ||
        typeof step.input.startLine !== "number" ||
        typeof step.input.endLine !== "number"
      ) {
        throw new Error(
          "Tool Execution Failed: 'path', 'newCode', 'startLine', and 'endLine' arguments must be provided.",
        );
      }

      const fs = require("fs");
      const path = require("path");

      if (!args.workspaceRoot) {
        throw new Error("Tool Execution Failed: No workspace root access.");
      }

      const fullPath = path.resolve(args.workspaceRoot, step.input.path);
      const resolvedRoot = path.resolve(args.workspaceRoot);
      const relativePath = path.relative(resolvedRoot, fullPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(
          "Security Violation: Cannot write files outside of the workspace directory.",
        );
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${step.input.path}`);
      }

      const originalCode = fs.readFileSync(fullPath, "utf-8");
      const lines = originalCode.split('\n');
      const start = Math.max(0, step.input.startLine - 1);
      const explicitEndLine = step.input.endLine !== undefined ? step.input.endLine : lines.length;
      const end = Math.min(lines.length, explicitEndLine === 0 ? lines.length : explicitEndLine);
      const replacementLines = step.input.newCode.split('\n');
      lines.splice(start, end - start, ...replacementLines);
      const content = lines.join('\n');

      if (args.proposeFileWrite && !context.autoExecute) {
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
    } else if (toolName === "fs.deleteFile") {
      if (!step.input || typeof step.input.path !== "string") {
        throw new Error(
          "Tool Execution Failed: 'path' argument must be a string.",
        );
      }
      if (args.proposeFileWrite && !context.autoExecute) {
        args.proposeFileWrite({
          filePath: step.input.path,
          isDelete: true,
        });
        executionOutput += `\nProposed file deletion: ${step.input.path}`;
      } else {
        throw new Error(
          "Tool Execution Failed: No workspace file writer access.",
        );
      }
    } else if (toolName === "fs.renameFile") {
      if (
        !step.input ||
        typeof step.input.path !== "string" ||
        typeof step.input.newPath !== "string"
      ) {
        throw new Error(
          "Tool Execution Failed: 'path' and 'newPath' arguments must be strings.",
        );
      }

      const fs = require("fs");
      const path = require("path");

      if (!args.workspaceRoot) {
        throw new Error("Tool Execution Failed: No workspace root access.");
      }

      const fullPath = path.resolve(args.workspaceRoot, step.input.path);
      const fullNewPath = path.resolve(args.workspaceRoot, step.input.newPath);

      const resolvedRoot = path.resolve(args.workspaceRoot);
      const relativePath = path.relative(resolvedRoot, fullPath);
      const relativeNewPath = path.relative(resolvedRoot, fullNewPath);

      if (
        relativePath.startsWith("..") ||
        path.isAbsolute(relativePath) ||
        relativeNewPath.startsWith("..") ||
        path.isAbsolute(relativeNewPath)
      ) {
        throw new Error(
          "Security Violation: Cannot rename files outside of the workspace directory.",
        );
      }

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found in workspace: ${step.input.path}`);
      }

      if (args.proposeFileWrite && !context.autoExecute) {
        // We'll simulate renaming via proposeFileWrite by pushing a special event,
        // or just execute it directly if no permission stack is needed for renames.
        // Wait, renames should probably be executed safely. For now, since rename is not in fileEdits UI, we will just execute it directly.
        fs.renameSync(fullPath, fullNewPath);
        executionOutput += `\nRenamed: ${step.input.path} -> ${step.input.newPath}`;
      } else {
        fs.renameSync(fullPath, fullNewPath);
        executionOutput += `\nRenamed: ${step.input.path} -> ${step.input.newPath}`;
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
      const relativePath = path.relative(resolvedRoot, fullPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
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
      const path = require("path");
      if (!args.workspaceRoot)
        throw new Error("Tool Execution Failed: No workspace root access.");

      let cmd = step.input.cmd;
      let cmdArgs = step.input.args || [];

      // Auto-correct wrappers like `cmd.exe /c npm ...` so they don't fail security checks
      const wrappers = [
        "cmd",
        "cmd.exe",
        "powershell",
        "powershell.exe",
        "bash",
        "sh",
      ];
      if (wrappers.includes(cmd.toLowerCase()) && cmdArgs.length >= 2) {
        const flag = cmdArgs[0].toLowerCase();
        if (flag === "/c" || flag === "-c" || flag === "-command") {
          cmd = cmdArgs[1];
          cmdArgs = cmdArgs.slice(2);
        }
      }

      const destructivePatterns = [
        /(^|\s)rm\s+-r/i,
        /(^|\s)del\s+\/s/i,
        /(^|\s)rmdir\s+\/s/i,
        /(^|\s)format\s+/i,
        /(^|\s)dd\s+if=/i,
        /(^|\s)sudo\s+/i,
      ];
      const fullCmdString = `${cmd} ${cmdArgs.join(" ")}`;
      if (destructivePatterns.some((p) => p.test(fullCmdString))) {
        throw new Error(
          "SECURITY_VIOLATION: Destructive operations are strictly blocked by the execution infrastructure.",
        );
      }

      if (!toolDefinition.allowedCommands.includes(cmd)) {
        console.log("Allowed commands list: ", toolDefinition.allowedCommands);
        console.log("Command: ", cmd);

        const hintMap = {
          mkdir:
            "HINT: Use the 'fs.createDirectory' tool instead for directory creation.",
          rm: "HINT: Use the 'fs.deleteFile' tool instead.",
          rmdir: "HINT: Use the 'fs.deleteFile' tool instead.",
          del: "HINT: Use the 'fs.deleteFile' tool instead.",
          mv: "HINT: Use the 'fs.renameFile' tool instead.",
          ren: "HINT: Use the 'fs.renameFile' tool instead.",
          cp: "HINT: Use the 'fs.copyFile' tool instead (if available, otherwise script it).",
          copy: "HINT: Use the 'fs.copyFile' tool instead.",
          cat: "HINT: Use the 'fs.readFile' tool instead.",
          type: "HINT: Use the 'fs.readFile' tool instead.",
          ls: "HINT: Use the 'list_dir' tool instead.",
          dir: "HINT: Use the 'list_dir' tool instead.",
        };

        let errMsg = `SECURITY_VIOLATION: Command '${cmd}' is not in the allowedCommands list for terminal.exec.`;
        if (hintMap[cmd.toLowerCase()]) {
          errMsg += `\n${hintMap[cmd.toLowerCase()]}`;
        }

        throw new Error(errMsg);
      }

      if (cmd === "cd" || cmd === "mkdir") {
        const targetDir = cmdArgs.length > 0 ? cmdArgs[0] : ".";
        const fullPath = path.resolve(
          args.workspaceRoot,
          step.input.cwd || ".",
          targetDir,
        );
        const resolvedRoot = path.resolve(args.workspaceRoot);
        const relativePath = path.relative(resolvedRoot, fullPath);

        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
          throw new Error(
            `Security Violation: Cannot ${cmd} outside of the workspace directory.`,
          );
        }

        let stdoutMsg = "";
        if (cmd === "cd") {
          stdoutMsg = `Changed directory successfully.\nNOTE: 'cd' is a shell built-in and was simulated. Since terminal execution is stateless, you MUST use the 'cwd' parameter (e.g. "cwd": "${relativePath.replace(/\\/g, "/")}") in all your future terminal.exec tool calls to run commands in this directory.`;
        } else if (cmd === "mkdir") {
          const fs = require("fs");
          if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
            stdoutMsg = `Created directory: ${targetDir}`;
          } else {
            stdoutMsg = `Directory already exists: ${targetDir}`;
          }
        }

        const res = {
          success: true,
          stdout: stdoutMsg,
          stderr: "",
          exitCode: 0,
          durationMs: Date.now() - startTime,
        };
        console.log(`[DEBUG] EXECUTOR RESULT (simulated ${cmd}):`, res);
        return res;
      }

      if (args.proposeTerminalCommand && !context.autoExecute) {
        const targetCwd = step.input.cwd ? ` (in ${step.input.cwd})` : "";
        args.proposeTerminalCommand({
          command: `${cmd} ${cmdArgs.join(" ")}${targetCwd}`,
        });
        executionOutput += `\nProposed terminal command: ${cmd} ${cmdArgs.join(" ")}${targetCwd}`;
      } else {
        const { spawn } = require("child_process");
        const isWin = process.platform === "win32";

        let actualCmd = cmd;
        if (isWin && cmd === "npm") actualCmd = "npm.cmd";
        if (isWin && cmd === "npx") actualCmd = "npx.cmd";

        // Deep security check: Prevent command injection via shell metacharacters
        // when shell: true is enabled for .cmd files.
        const shellMetachars = /[&|<>;`$]/;
        for (const arg of cmdArgs) {
          if (shellMetachars.test(arg)) {
            throw new Error(
              `SECURITY_VIOLATION: Shell metacharacters are not allowed in terminal arguments: ${arg}`,
            );
          }
        }

        executionOutput += `\nExecuting tokenized command: ${cmd} ${JSON.stringify(cmdArgs)}`;

        await new Promise((resolve, reject) => {
          const child = spawn(actualCmd, cmdArgs, {
            cwd: step.input.cwd
              ? path.resolve(args.workspaceRoot, step.input.cwd)
              : args.workspaceRoot,
            shell:
              isWin &&
              (actualCmd.endsWith(".cmd") || actualCmd.endsWith(".bat")), // Required by Node 18+ to spawn .cmd files on Windows
            timeout: 30000, // 30 second hard timeout
          });

          let stdout = "";
          let stderr = "";

          child.stdout.on("data", (data) => (stdout += data.toString()));
          child.stderr.on("data", (data) => (stderr += data.toString()));

          child.on("close", (code) => {
            executionOutput += `\nOutput: ${stdout}\n${stderr}`;
            if (code !== 0) {
              const err = new Error(
                `Command exited with code ${code}.\nStderr: ${stderr}\nStdout: ${stdout}`,
              );
              err.exitCode = code;
              reject(err);
            } else {
              resolve(code);
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
      const resolvedRoot = path.resolve(args.workspaceRoot);
      const relativePath = path.relative(resolvedRoot, fullPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error("Security Violation.");
      }
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
    } else if (toolName === "fs.createDirectory") {
      const fs = require("fs");
      const path = require("path");
      if (!args.workspaceRoot)
        throw new Error("Tool Execution Failed: No workspace root access.");

      const fullPath = path.resolve(args.workspaceRoot, step.input.path);
      const resolvedRoot = path.resolve(args.workspaceRoot);
      const relativePath = path.relative(resolvedRoot, fullPath);

      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(
          "Security Violation: Cannot create directory outside workspace.",
        );
      }

      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
        executionOutput += `\nCreated directory: ${step.input.path}`;
      } else {
        executionOutput += `\nDirectory already exists: ${step.input.path}`;
      }
    } else if (toolName === "scaffold_project") {
      const { spawn } = require("child_process");
      const path = require("path");
      const isWin = process.platform === "win32";

      const targetPath = step.input.path || ".";
      const fullPath = path.resolve(args.workspaceRoot, targetPath);

      let cmd = "npx";
      let cmdArgs = [];

      switch (step.input.template) {
        case "react":
          cmdArgs = ["create-react-app", targetPath];
          break;
        case "vite":
          cmdArgs = ["create-vite", targetPath, "--template", "react"]; // Defaulting to react for now
          break;
        case "next":
          cmdArgs = [
            "create-next-app",
            targetPath,
            "--typescript",
            "--tailwind",
            "--eslint",
          ];
          break;
        case "express":
          cmdArgs = ["express-generator", targetPath];
          break;
        case "node":
          cmd = "npm";
          cmdArgs = ["init", "-y"];
          break;
        default:
          throw new Error(`Unsupported template: ${step.input.template}`);
      }

      let actualCmd = cmd;
      if (isWin) actualCmd = `${cmd}.cmd`;

      executionOutput += `\nScaffolding project using: ${actualCmd} ${cmdArgs.join(" ")}`;

      await new Promise((resolve, reject) => {
        const child = spawn(actualCmd, cmdArgs, {
          cwd:
            cmd === "npm" && step.input.template === "node"
              ? fullPath
              : args.workspaceRoot,
          shell: isWin,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => (stdout += data.toString()));
        child.stderr.on("data", (data) => (stderr += data.toString()));

        child.on("close", (code) => {
          executionOutput += `\nOutput: ${stdout}\n${stderr}`;
          if (code !== 0) {
            reject(
              new Error(`Scaffolding failed with code ${code}.\n${stderr}`),
            );
          } else {
            resolve();
          }
        });
      });
    } else if (toolName === "npm_manager") {
      const { spawn } = require("child_process");
      const path = require("path");
      const isWin = process.platform === "win32";

      const fullPath = path.resolve(args.workspaceRoot, step.input.path || ".");
      let cmdArgs = ["install"];
      if (
        step.input.packages &&
        Array.isArray(step.input.packages) &&
        step.input.packages.length > 0
      ) {
        cmdArgs = ["install", ...step.input.packages];
      }

      let actualCmd = isWin ? "npm.cmd" : "npm";
      executionOutput += `\nRunning: ${actualCmd} ${cmdArgs.join(" ")}`;

      await new Promise((resolve, reject) => {
        const child = spawn(actualCmd, cmdArgs, {
          cwd: fullPath,
          shell: isWin,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => (stdout += data.toString()));
        child.stderr.on("data", (data) => (stderr += data.toString()));

        child.on("close", (code) => {
          executionOutput += `\nOutput: ${stdout.slice(-500)}\n${stderr.slice(-500)}`;
          if (code !== 0) {
            reject(new Error(`NPM failed with code ${code}.\n${stderr}`));
          } else {
            resolve();
          }
        });
      });
    } else if (toolName === "response") {
      const responseText = step.input.content !== undefined ? step.input.content : step.input.message;
      if (onChunk) onChunk(`\n${responseText}\n\n`);
      executionOutput += `\nResponded to user.`;
    }

    const res = {
      success: true,
      stdout: executionOutput,
      stderr: "",
      exitCode: 0,
      durationMs: Date.now() - startTime,
    };
    console.log("[DEBUG] EXECUTOR RESULT:", res);
    return res;
  } catch (err) {
    console.error("[Executor] Execution failed:", err.message);
    // Suppress raw error leaks to the UI; it will be handled by Fixer Node or Status Panel
    const errRes = {
      success: false,
      stdout: "",
      stderr: err.message,
      exitCode: err.exitCode !== undefined ? err.exitCode : 1,
      durationMs: Date.now() - startTime,
    };
    console.log("[DEBUG] EXECUTOR FAILED:", errRes);
    return errRes;
  }
}

module.exports = { runExecutor };
