const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { TOOL_REGISTRY } = require("./toolRegistry");
const { Logger } = require("../telemetry/Logger");
const { eventBus } = require("../core/event_bus");
const container = require("./DiContainer");

async function verifyExecution(args, filePath, expectedContent) {
  if (args.workspaceRoot) {
    const fullPath = path.resolve(args.workspaceRoot, filePath);
    // Give FS a moment to flush if it's virtual
    await new Promise((r) => setTimeout(r, 100));
    if (fs.existsSync(fullPath)) {
      const writtenCode = fs.readFileSync(fullPath, "utf-8");
      if (writtenCode !== expectedContent) {
        throw new Error(
          "Tool Execution Failed: Verification failed. The written file content does not match the requested content.",
        );
      }
    }
  }
}

// ─── Tool Name Alias Map ────────────────────────────────────────────────────
// Remaps common LLM hallucinations / alternate spellings to the exact
// registered name in TOOL_REGISTRY. Extend this as new patterns emerge.
const TOOL_NAME_ALIASES = {
  // file creation variants
  create_file: "fs.createFile",
  createFile: "fs.createFile",
  "fs.create_file": "fs.createFile",
  // file writing variants
  write_file: "fs.writeFile",
  writeFile: "fs.writeFile",
  "fs.write_file": "fs.writeFile",
  // file reading variants
  read_file: "fs.readFile",
  readFile: "fs.readFile",
  "fs.read_file": "fs.readFile",
  // file editing variants
  edit_file: "fs.editFileLines",
  editFile: "fs.editFileLines",
  "fs.editFile": "fs.editFileLines",
  "fs.edit_file": "fs.editFileLines",
  // rename/move variants
  rename_file: "fs.renameFile",
  renameFile: "fs.renameFile",
  move_file: "fs.renameFile",
  // update/overwrite variants (alias to writeFile)
  "fs.updateFile": "fs.writeFile",
  updateFile: "fs.writeFile",
  update_file: "fs.writeFile",
  "fs.update_file": "fs.writeFile",
  // delete variants
  delete_file: "fs.deleteFile",
  deleteFile: "fs.deleteFile",
  remove_file: "fs.deleteFile",
  // directory variants
  list_directory: "list_dir",
  listDir: "list_dir",
  readdir: "fs.readdir",
  // shell variants
  "shell.exec": "terminal.exec",
  exec: "terminal.exec",
  run_command: "terminal.exec",
  // response variants
  answer: "response",
  reply: "response",
  user_query: "response",
  ask_user: "ask_user_for_input",
};
// ────────────────────────────────────────────────────────────────────────────

async function runExecutor(step, context, args) {
  const { onChunk, onStatus } = args;
  const startTime = Date.now();

  const rawName = step.tool || step.skill;
  // Resolve alias before lookup so hallucinated names still work
  const toolName = TOOL_NAME_ALIASES[rawName] || rawName;
  const toolDefinition = TOOL_REGISTRY[toolName];

  // --- TOOL NORMALIZATION GUARD (SINGLE SOURCE OF TRUTH) ---
  if (!toolDefinition) {
    return {
      success: false,
      stdout: "",
      stderr: `TOOL_HALLUCINATION_ERROR: The requested tool '${rawName}' is not registered in TOOL_REGISTRY. You must only use listed tools.`,
      status: "REPLAN_NEEDED",
    };
  }
  if (rawName !== toolName) {
    console.warn(
      `[Executor] Tool alias resolved: '${rawName}' → '${toolName}'`,
    );
  }

  // --- SCHEMA VALIDATOR ENGINE ---
  const input = step.input || {};
  if (toolName === "google_search" && !input.query) {
    input.query = input.q || input.search || input.text || input.pattern || input.keyword || "";
  }
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
  Logger.debug("Executor", `Executing ${toolName}`, step);

  let executionOutput = "";

  const toolRuntime = container.get("ToolRuntime");
  const { CancellationToken } = require("./runtime/ToolRuntime");
  const cancellationToken = args.cancellationToken || new CancellationToken();

  const runResult = await toolRuntime.execute(
    async () => {
      if (toolName === "fs.writeFile" || toolName === "fs.createFile") {
        // Use the provided Workspace API instead of blind fs writes
        if (!step.input || typeof step.input.path !== "string") {
          throw new Error(
            "Tool Execution Failed: 'path' argument must be a string.",
          );
        }

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
          eventBus.writeJournalEvent(
            args.correlationId || "default",
            "ProposedEditCreated",
            {
              filePath: step.input.path,
              isNew: isNew,
              isDelete: false,
            },
          );
          // Execute via the virtual workspace layer
          await args.proposeFileWrite({
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
          await verifyExecution(args, step.input.path, content);
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
          eventBus.writeJournalEvent(
            args.correlationId || "default",
            "ProposedEditCreated",
            {
              filePath: step.input.path,
              isNew: false,
              isDelete: false,
            },
          );
          await args.proposeFileWrite({
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
          await verifyExecution(args, step.input.path, content);
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
        const lines = originalCode.split("\n");
        const start = Math.max(0, step.input.startLine - 1);
        const explicitEndLine =
          step.input.endLine !== undefined ? step.input.endLine : lines.length;
        const end = Math.min(
          lines.length,
          explicitEndLine === 0 ? lines.length : explicitEndLine,
        );
        const replacementLines = step.input.newCode.split("\n");
        lines.splice(start, end - start, ...replacementLines);
        const content = lines.join("\n");

        if (args.proposeFileWrite && !context.autoExecute) {
          eventBus.writeJournalEvent(
            args.correlationId || "default",
            "ProposedEditCreated",
            {
              filePath: step.input.path,
              isNew: false,
              isDelete: false,
            },
          );
          await args.proposeFileWrite({
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
          eventBus.writeJournalEvent(
            args.correlationId || "default",
            "ProposedEditCreated",
            {
              filePath: step.input.path,
              isNew: false,
              isDelete: true,
            },
          );
          await args.proposeFileWrite({
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
        const oldPath = step.input.oldPath || step.input.path;
        if (
          !step.input ||
          typeof oldPath !== "string" ||
          typeof step.input.newPath !== "string"
        ) {
          throw new Error(
            "Tool Execution Failed: 'oldPath' and 'newPath' arguments must be strings.",
          );
        }

        if (!args.workspaceRoot) {
          throw new Error("Tool Execution Failed: No workspace root access.");
        }

        const fullPath = path.resolve(args.workspaceRoot, oldPath);
        const fullNewPath = path.resolve(
          args.workspaceRoot,
          step.input.newPath,
        );

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
          // await args.proposeFileWrite(...) could be added if rename UI is built.
          fs.renameSync(fullPath, fullNewPath);
          executionOutput += `\nRenamed: ${step.input.path} -> ${step.input.newPath}`;
        } else {
          fs.renameSync(fullPath, fullNewPath);
          executionOutput += `\nRenamed: ${step.input.path} -> ${step.input.newPath}`;
        }
      } else if (toolName === "fs.readFile") {
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

        if (!toolDefinition.allowedCommands.includes(cmd)) {
          console.log(
            "Allowed commands list: ",
            toolDefinition.allowedCommands,
          );
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

        if (args.proposeTerminalCommand && !context.autoExecute) {
          const targetCwd = step.input.cwd ? ` (in ${step.input.cwd})` : "";
          const commandString = `${cmd} ${cmdArgs.join(" ")}${targetCwd}`;
          eventBus.writeJournalEvent(
            args.correlationId || "default",
            "ProposedCommandCreated",
            {
              command: commandString,
            },
          );
          args.proposeTerminalCommand({
            command: commandString,
          });
          executionOutput += `\nProposed terminal command: ${commandString}`;
        } else {
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
                err["exitCode"] = code;
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
      } else if (toolName === "list_dir" || toolName === "fs.readdir") {
        if (!args.workspaceRoot)
          throw new Error("Tool Execution Failed: No workspace root access.");

        const fullPath = path.resolve(
          args.workspaceRoot,
          step.input.path || "",
        );
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
        if (!args.workspaceRoot)
          throw new Error("Tool Execution Failed: No workspace root access.");

        const searchPattern = step.input.query || step.input.pattern;
        const dirPath = step.input.directory || step.input.path || ".";
        const fullSearchPath = path.resolve(args.workspaceRoot, dirPath);

        if (!searchPattern)
          throw new Error("grep_search requires a 'query' parameter.");
        if (!fs.existsSync(fullSearchPath))
          throw new Error(`Directory not found: ${dirPath}`);

        const results = [];
        const walkDir = (dir) => {
          if (results.length > 50) return;
          let list;
          try {
            list = fs.readdirSync(dir);
          } catch (e) {
            return;
          }
          list.forEach((file) => {
            if (results.length > 50) return;
            if (
              file === "node_modules" ||
              file === ".git" ||
              file === ".jarvix"
            )
              return;
            const fp = path.join(dir, file);
            const stat = fs.statSync(fp);
            if (stat && stat.isDirectory()) {
              walkDir(fp);
            } else {
              try {
                const fileContent = fs.readFileSync(fp, "utf-8");
                if (
                  fileContent
                    .toLowerCase()
                    .includes(searchPattern.toLowerCase())
                ) {
                  results.push(path.relative(args.workspaceRoot, fp));
                }
              } catch (e) {}
            }
          });
        };
        walkDir(fullSearchPath);
        executionOutput += `\nFound ${results.length} file(s) matching '${searchPattern}' in '${dirPath}':\n${results.join("\n")}`;
      } else if (toolName === "fs.createDirectory") {
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
        const isWin = process.platform === "win32";

        const fullPath = path.resolve(
          args.workspaceRoot,
          step.input.path || ".",
        );
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
      } else if (
        toolName === "response" ||
        toolName === "ask_user_for_input" ||
        toolName === "user_prompt"
      ) {
        const responseText =
          step.input.content !== undefined
            ? step.input.content
            : step.input.message;
        if (onChunk) onChunk(`\n${responseText}\n\n`);
        executionOutput += `\nResponded to user.`;
      }

      return executionOutput;
    },
    step.input,
    cancellationToken,
  );

  const res = {
    success: runResult.success,
    stdout: runResult.success ? runResult.output : "",
    stderr: runResult.success ? "" : runResult.error,
    exitCode: runResult.success ? 0 : 1,
    durationMs: runResult.duration,
  };
  console.log("[DEBUG] EXECUTOR RESULT:", res);
  return res;
}

module.exports = { runExecutor };
