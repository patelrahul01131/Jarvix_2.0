const vscode = require("vscode");
const path = require("path");
const fs = require("fs");
const { askAgent } = require("./src/agent-core/loop");
const {
  writeFileToWorkspace,
  deleteFileFromWorkspace,
  listWorkspaceFiles,
  getWorkspaceRoot,
} = require("./src/tools/fileSystem");
const {
  getAllSessions,
  saveSession,
  deleteSession,
  clearAllSessions,
} = require("./src/memory/shortTerm");

// ─── Persistent backup log ─────────────────────────────────────────────────────
/**
 * Write a backup of original file contents BEFORE any writes are applied.
 * Stored in <workspace>/.jarvix/backups/<timestamp>.json
 * @param {{ path: string, originalContent: string }[]} fileSnapshots
 */
function writeBackupLog(fileSnapshots) {
  try {
    const root = getWorkspaceRoot();
    if (!root || fileSnapshots.length === 0) return;
    const backupDir = path.join(root, ".jarvix", "backups");
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = Date.now();
    const backupPath = path.join(backupDir, `${timestamp}.json`);
    const payload = { timestamp, files: fileSnapshots };
    fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), "utf8");
    console.log(`[Jarvix] Backup written: ${backupPath}`);
  } catch (e) {
    console.warn("[Jarvix] Failed to write backup log:", e.message);
  }
}

// ─── Atomic transaction: write multiple files or roll back all ─────────────────
/**
 * Apply a batch of file edits as an atomic transaction.
 * If any write fails, all previously written files are rolled back.
 * @param {{ filePath: string, code: string, isNew: boolean, isDelete: boolean, originalCode: string }[]} edits
 * @param {vscode.WebviewPanel} panel
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function applyAtomicTransaction(edits, panel) {
  // Snapshot originals for backup + rollback
  const snapshots = [];
  for (const edit of edits) {
    if (!edit.isDelete && !edit.isNew && edit.originalCode != null) {
      snapshots.push({
        path: edit.filePath,
        originalContent: edit.originalCode,
      });
    }
  }

  // Write backup before any changes
  writeBackupLog(snapshots);

  const written = []; // Track successfully written edits for rollback
  try {
    for (const edit of edits) {
      if (edit.isDelete) {
        let content = null;
        const fullPath = path.isAbsolute(edit.filePath)
          ? edit.filePath
          : path.join(getWorkspaceRoot() || "", edit.filePath);
        if (fs.existsSync(fullPath)) {
          content = fs.readFileSync(fullPath, "utf8");
        }
        const success = deleteFileFromWorkspace(edit.filePath);
        if (!success)
          throw new Error(
            `File not found or could not be deleted: ${edit.filePath}`,
          );
        written.push({ ...edit, _wasDeleted: true, originalCode: content });
      } else {
        await writeAndSync(edit.filePath, edit.code, panel);
        written.push(edit);
      }
    }
    return { success: true };
  } catch (err) {
    console.error("[Jarvix] Atomic write failed, rolling back:", err.message);
    // Rollback: restore all previously written files
    for (const w of written) {
      try {
        if (w._wasDeleted) {
          if (w.originalCode != null) {
            await writeAndSync(w.filePath, w.originalCode, panel);
            console.log(
              `[Jarvix] Rolled back (restored deleted file): ${w.filePath}`,
            );
          } else {
            console.warn(
              `[Jarvix] Cannot restore deleted file (no content): ${w.filePath}`,
            );
          }
        } else if (!w.isNew && w.originalCode != null) {
          // Restore original content
          await writeAndSync(w.filePath, w.originalCode, panel);
          console.log(`[Jarvix] Rolled back: ${w.filePath}`);
        } else if (w.isNew) {
          // Delete the newly created file
          deleteFileFromWorkspace(w.filePath);
          console.log(`[Jarvix] Rolled back (deleted new file): ${w.filePath}`);
        }
      } catch (rbErr) {
        console.warn(
          `[Jarvix] Rollback failed for ${w.filePath}:`,
          rbErr.message,
        );
      }
    }
    return { success: false, error: err.message };
  }
}

function getWebviewContent(webview, extensionUri) {
  const bundlePath = vscode.Uri.joinPath(
    extensionUri,
    "webview",
    "dist",
    "bundle.js",
  );
  const bundleUri = webview.asWebviewUri(bundlePath);
  const htmlPath = path.join(extensionUri.fsPath, "webview", "index.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  html = html.replace("${bundleUri}", bundleUri.toString());
  return html;
}

// ─── Shared helper: write a file and sync the open editor ─────────────────────
async function writeAndSync(filePath, code, panel) {
  // Use VS Code workspace paths safely
  const { getWorkspaceRoot } = require("./src/tools/fileSystem");
  const root = getWorkspaceRoot();
  if (!root) throw new Error("No workspace open");

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath);
  const uri = vscode.Uri.file(absolutePath);

  const openDoc = vscode.workspace.textDocuments.find(
    (d) =>
      d.fileName.toLowerCase().replace(/\\/g, "/") ===
      absolutePath.toLowerCase().replace(/\\/g, "/"),
  );

  if (openDoc) {
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      openDoc.positionAt(0),
      openDoc.positionAt(openDoc.getText().length),
    );
    edit.replace(uri, fullRange, code);
    await vscode.workspace.applyEdit(edit);
    await openDoc.save();
  } else {
    // Write via VS Code's native filesystem API so watchers fire correctly
    await vscode.workspace.fs.writeFile(
      uri,
      new Uint8Array(Buffer.from(code, "utf8")),
    );
  }
  return absolutePath;
}

function activate(context) {
  const command = vscode.commands.registerCommand("myAgent.open", () => {
    const panel = vscode.window.createWebviewPanel(
      "jarvix",
      "Jarvix",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "webview", "dist"),
        ],
        retainContextWhenHidden: true,
      },
    );

    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

    // AbortController for stop-generation
    let activeAbortController = null;

    panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "getSessions": {
          const sessions = getAllSessions();
          panel.webview.postMessage({ type: "sessionsLoaded", sessions });
          break;
        }

        case "getWorkspaceFiles": {
          const files = listWorkspaceFiles();
          panel.webview.postMessage({ type: "workspaceFiles", files });
          break;
        }

        case "stopGeneration": {
          if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
          }
          panel.webview.postMessage({ type: "generationStopped" });
          break;
        }

        case "ask": {
          try {
            activeAbortController = new AbortController();
            await askAgent({
              workspaceRoot: getWorkspaceRoot(),
              workspaceFiles: listWorkspaceFiles(),
              question: msg.question,
              mode: msg.mode,
              model: msg.model,
              provider: msg.provider,
              sessionId: msg.sessionId,
              planModeEnabled: msg.planModeEnabled,
              explicitFiles: msg.explicitFiles || [],
              attachedImages: msg.attachedImages || [],
              signal: activeAbortController.signal,

              onStatus: (status) => {
                panel.webview.postMessage({ type: "status", status });
              },

              onState: (stateUpdate) => {
                panel.webview.postMessage({
                  type: "AGENT_STATE",
                  ...stateUpdate,
                });
              },

              onChunk: (partialReply) => {
                panel.webview.postMessage({
                  type: "partialReply",
                  sessionId: msg.sessionId,
                  content: partialReply,
                });
              },

              onFileWrite: async ({ filePath, code, isNew }) => {
                try {
                  await writeAndSync(filePath, code, panel);
                  const label = isNew
                    ? `Jarvix created: ${filePath}`
                    : `Jarvix updated: ${filePath}`;
                  vscode.window.showInformationMessage(label);
                  panel.webview.postMessage({
                    type: "fileAutoWritten",
                    filePath,
                    isNew,
                  });
                } catch (err) {
                  vscode.window.showErrorMessage("Write error: " + err.message);
                }
              },
            });
            activeAbortController = null;

            const sessions = getAllSessions();
            const session = sessions[msg.sessionId];
            panel.webview.postMessage({
              type: "reply",
              sessionId: msg.sessionId,
              session,
            });
          } catch (err) {
            activeAbortController = null;
            // Silently ignore abort errors (user clicked Stop)
            if (
              err.name === "AbortError" ||
              err.message?.includes("aborted") ||
              err.message?.includes("canceled")
            ) {
              panel.webview.postMessage({ type: "generationStopped" });
              break;
            }
            console.error("Ask error:", err);
            try {
              const sessions = getAllSessions();
              const session = sessions[msg.sessionId];
              if (session) {
                session.messages = session.messages.filter((m) => !m.streaming);
                session.messages.push({
                  role: "assistant",
                  content: `⚠️ **Error:** ${err.message}`,
                  isError: true,
                });
                saveSession(msg.sessionId, session);
              }
            } catch (e) {}

            panel.webview.postMessage({
              type: "reply",
              sessionId: msg.sessionId,
              session: getAllSessions()[msg.sessionId],
            });
            const isApiError =
              /quota|rate.?limit|rate_limit|model.?not|not.?found|insufficient|restricted|api.?key/i.test(
                err.message,
              );
            if (!isApiError) {
              vscode.window.showErrorMessage("Jarvix error: " + err.message);
            }
          }
          break;
        }

        case "approvePlan": {
          try {
            const sessions = getAllSessions();
            const session = sessions[msg.sessionId];
            if (!session) {
              throw new Error("Session not found");
            }

            // Mark the plan as approved in the session message history
            if (
              msg.messageIndex !== undefined &&
              session.messages[msg.messageIndex]
            ) {
              session.messages[msg.messageIndex].planStatus = "approved";
              saveSession(msg.sessionId, session);
              panel.webview.postMessage({
                type: "reply",
                sessionId: msg.sessionId,
                session,
              });
            }

            let _activeRuntime = null;
            activeAbortController = new AbortController();
            await askAgent({
              workspaceRoot: getWorkspaceRoot(),
              workspaceFiles: listWorkspaceFiles(),
              question:
                "Execute the approved implementation plan and perform all the modifications and creations.",
              model: msg.model,
              provider: msg.provider,
              sessionId: msg.sessionId,
              executePlan: true,
              signal: activeAbortController.signal,

              onStatus: (status) => {
                panel.webview.postMessage({ type: "status", status });
              },

              // ── Runtime progress → UI ──────────────────────────────────────
              onState: (stateUpdate) => {
                panel.webview.postMessage({
                  type: "AGENT_STATE",
                  ...stateUpdate,
                });
                // Cache the runtime reference so we can pause/resume it later
                if (
                  stateUpdate.type !== "EXECUTION_PROGRESS" &&
                  stateUpdate._runtime
                ) {
                  _activeRuntime = stateUpdate._runtime;
                }
              },

              onProgress: (progressEvent) => {
                panel.webview.postMessage({
                  type: "EXECUTION_PROGRESS",
                  sessionId: msg.sessionId,
                  ...progressEvent,
                });
              },

              onChunk: (partialReply) => {
                panel.webview.postMessage({
                  type: "partialReply",
                  sessionId: msg.sessionId,
                  content: partialReply,
                });
              },

              onFileWrite: async ({ filePath, code, isNew }) => {
                try {
                  await writeAndSync(filePath, code, panel);
                  const label = isNew
                    ? `Jarvix created: ${filePath}`
                    : `Jarvix updated: ${filePath}`;
                  vscode.window.showInformationMessage(label);
                  panel.webview.postMessage({
                    type: "fileAutoWritten",
                    filePath,
                    isNew,
                  });
                } catch (err) {
                  vscode.window.showErrorMessage("Write error: " + err.message);
                }
              },
            });
            activeAbortController = null;
            _activeRuntime = null;

            panel.webview.postMessage({
              type: "reply",
              sessionId: msg.sessionId,
              session: getAllSessions()[msg.sessionId],
            });
          } catch (err) {
            console.error("Approve plan error:", err);
            try {
              const sessions = getAllSessions();
              const session = sessions[msg.sessionId];
              if (session) {
                session.messages = session.messages.filter((m) => !m.streaming);
                session.messages.push({
                  role: "assistant",
                  content: `⚠️ **Error executing plan:** ${err.message}`,
                  isError: true,
                });
                saveSession(msg.sessionId, session);
              }
            } catch (e) {}

            panel.webview.postMessage({
              type: "reply",
              sessionId: msg.sessionId,
              session: getAllSessions()[msg.sessionId],
            });
            const isApiError =
              /quota|rate.?limit|rate_limit|model.?not|not.?found|insufficient|restricted|api.?key|fetch.?failed/i.test(
                err.message,
              );
            if (!isApiError) {
              vscode.window.showErrorMessage("Jarvix error: " + err.message);
            }
          }
          break;
        }

        case "writeFile": {
          try {
            const editor = vscode.window.activeTextEditor;
            if (msg.filePath && typeof msg.filePath === "string") {
              await writeAndSync(msg.filePath, msg.code, panel);
              vscode.window.showInformationMessage(
                `Jarvix updated: ${msg.filePath}`,
              );
            } else if (editor) {
              const document = editor.document;
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length),
              );
              await editor.edit((editBuilder) => {
                editBuilder.replace(fullRange, msg.code);
              });
              await document.save();
              vscode.window.showInformationMessage(
                "Jarvix updated current file.",
              );
            } else {
              vscode.window.showErrorMessage("No file path provided.");
            }
            panel.webview.postMessage({ type: "fileWritten" });
          } catch (err) {
            vscode.window.showErrorMessage(
              "Failed to write file: " + err.message,
            );
          }
          break;
        }

        case "saveSession": {
          saveSession(msg.sessionId, msg.session);
          break;
        }

        case "deleteSession": {
          if (msg.sessionId) deleteSession(msg.sessionId);
          break;
        }

        case "clearAllSessions": {
          clearAllSessions();
          break;
        }

        case "applyPendingFile": {
          try {
            // Gather the edit for atomic transaction
            const sessions = getAllSessions();
            const session = sessions[msg.sessionId];
            let originalCode = null;
            if (
              session?.messages[msg.messageIndex]?.fileEdits?.[msg.fileIndex]
            ) {
              originalCode =
                session.messages[msg.messageIndex].fileEdits[msg.fileIndex]
                  .originalCode;
            }

            const atomicEdit = {
              filePath: msg.filePath,
              code: msg.code,
              isNew: msg.isNew || false,
              isDelete: msg.isDelete || false,
              originalCode,
            };

            const { success, error } = await applyAtomicTransaction(
              [atomicEdit],
              panel,
            );

            if (!success) {
              throw new Error(error || "Atomic write failed");
            }

            if (msg.isDelete) {
              vscode.window.showInformationMessage(
                `Jarvix deleted: ${msg.filePath}`,
              );
            } else {
              vscode.window.showInformationMessage(
                `Jarvix wrote: ${msg.filePath}`,
              );
            }

            if (session && session.messages[msg.messageIndex]) {
              const fileEdits = session.messages[msg.messageIndex].fileEdits;
              if (fileEdits && fileEdits[msg.fileIndex]) {
                fileEdits[msg.fileIndex].status = "accepted";
                session.messages.push({
                  role: "system",
                  content: `[TOOL VERIFICATION] User ACCEPTED file action: ${msg.isDelete ? "delete" : msg.isNew ? "create" : "edit"} on ${msg.filePath}`,
                });
                saveSession(msg.sessionId, session);
              }
            }
            panel.webview.postMessage({
              type: "sessionsLoaded",
              sessions: getAllSessions(),
            });
          } catch (err) {
            vscode.window.showErrorMessage("Action error: " + err.message);
          }
          break;
        }

        case "declinePendingFile": {
          const sessions = getAllSessions();
          const session = sessions[msg.sessionId];
          if (session && session.messages[msg.messageIndex]) {
            const fileEdits = session.messages[msg.messageIndex].fileEdits;
            if (fileEdits && fileEdits[msg.fileIndex]) {
              fileEdits[msg.fileIndex].status = "declined";
              session.messages.push({
                role: "system",
                content: `[TOOL VERIFICATION] User DECLINED file action on ${fileEdits[msg.fileIndex].filePath}. The file was not modified.`,
              });
              saveSession(msg.sessionId, session);
            }
          }
          panel.webview.postMessage({
            type: "sessionsLoaded",
            sessions: getAllSessions(),
          });
          break;
        }

        case "undoDeclinePendingFile": {
          const sessions = getAllSessions();
          const session = sessions[msg.sessionId];
          if (session && session.messages[msg.messageIndex]) {
            const fileEdits = session.messages[msg.messageIndex].fileEdits;
            if (fileEdits && fileEdits[msg.fileIndex]) {
              fileEdits[msg.fileIndex].status = "pending";

              // Remove the TOOL VERIFICATION declined message to clean up the timeline
              const targetPath = fileEdits[msg.fileIndex].filePath;
              session.messages = session.messages.filter(
                (m) =>
                  !(
                    m.role === "system" &&
                    m.content.includes("DECLINED file action") &&
                    m.content.includes(targetPath)
                  ),
              );

              saveSession(msg.sessionId, session);
            }
          }
          panel.webview.postMessage({
            type: "sessionsLoaded",
            sessions: getAllSessions(),
          });
          break;
        }

        case "runTerminalCommand": {
          try {
            const sessions = getAllSessions();
            const session = sessions[msg.sessionId];
            if (session && session.messages[msg.messageIndex]) {
              const commands =
                session.messages[msg.messageIndex].suggestedCommands;
              if (commands && commands[msg.commandIndex]) {
                commands[msg.commandIndex].status = "accepted";
                session.messages.push({
                  role: "system",
                  content: `[TOOL VERIFICATION] User EXECUTED terminal command: ${msg.command}`,
                });
                saveSession(msg.sessionId, session);
              }
            }

            const { spawn } = require("child_process");
            const cwd = getWorkspaceRoot();

            vscode.window.showInformationMessage(
              `Jarvix executing: ${msg.command}`,
            );
            panel.webview.postMessage({
              type: "status",
              status: `[${new Date().toLocaleTimeString()}] ⚙️ Executing command: ${msg.command}...`,
            });

            const proc = spawn(msg.command, {
              shell: process.platform === "win32" ? "powershell.exe" : true,
              cwd,
            });

            const currentSession = getAllSessions()[msg.sessionId];

            if (currentSession) {
              if (!currentSession.executionLogs)
                currentSession.executionLogs = [];
              const logEntry = {
                stepId: msg.messageIndex,
                command: msg.command,
                status: "running",
                stdout: [],
                stderr: [],
                exitCode: null,
                durationMs: 0,
              };
              currentSession.executionLogs.push(logEntry);
              saveSession(msg.sessionId, currentSession);
            }

            const startTime = Date.now();

            const sendStreamToUI = (streamType, chunk) => {
              panel.webview.postMessage({
                type: "streamLog",
                sessionId: msg.sessionId,
                command: msg.command,
                stream: streamType,
                data: chunk,
              });

              if (currentSession) {
                const logEntry = currentSession.executionLogs.find(
                  (l) => l.command === msg.command && l.status === "running",
                );
                if (logEntry) {
                  logEntry[streamType].push(...chunk.split("\n"));
                  if (logEntry[streamType].length > 100) {
                    logEntry[streamType] = logEntry[streamType].slice(-100);
                  }
                }
              }
            };

            proc.stdout.on("data", (d) =>
              sendStreamToUI("stdout", d.toString()),
            );
            proc.stderr.on("data", (d) =>
              sendStreamToUI("stderr", d.toString()),
            );

            const isLongRunning =
              /^(npm start|npm run dev|node server\.js|nodemon|vite)/.test(
                msg.command,
              );

            if (isLongRunning) {
              // For long running, notify the agent after a startup delay
              setTimeout(async () => {
                if (currentSession) {
                  const logEntry = currentSession.executionLogs.find(
                    (l) => l.command === msg.command && l.status === "running",
                  );
                  const startupLogs = logEntry
                    ? logEntry.stdout.join("\n")
                    : "";
                  currentSession.messages.push({
                    role: "system",
                    content: `[TOOL_RESULT] Background process started (PID: ${proc.pid})\nCommand: ${msg.command}\nInitial Logs:\n${startupLogs}`,
                  });
                  saveSession(msg.sessionId, currentSession);

                  activeAbortController = new AbortController();
                  await askAgent({
                    workspaceRoot: cwd,
                    workspaceFiles: listWorkspaceFiles(),
                    question: "Background process started. Proceed.",
                    executePlan: true,
                    sessionId: msg.sessionId,
                    model: msg.model,
                    provider: msg.provider,
                    signal: activeAbortController.signal,
                    onStatus: (status) =>
                      panel.webview.postMessage({ type: "status", status }),
                    onChunk: (partialReply) =>
                      panel.webview.postMessage({
                        type: "partialReply",
                        sessionId: msg.sessionId,
                        content: partialReply,
                      }),
                    onFileWrite: async ({ filePath, code, isNew }) => {
                      try {
                        await writeAndSync(filePath, code, panel);
                        panel.webview.postMessage({
                          type: "fileAutoWritten",
                          filePath,
                          isNew,
                        });
                      } catch (e) {}
                    },
                  });
                }
              }, 3000);
            } else {
              proc.on("close", async (code) => {
                const durationMs = Date.now() - startTime;
                if (currentSession) {
                  const logEntry = currentSession.executionLogs.find(
                    (l) => l.command === msg.command && l.status === "running",
                  );
                  if (logEntry) {
                    logEntry.status = code === 0 ? "success" : "failed";
                    logEntry.exitCode = code;
                    logEntry.durationMs = durationMs;
                  }

                  const stdoutStr = logEntry ? logEntry.stdout.join("\n") : "";
                  const stderrStr = logEntry ? logEntry.stderr.join("\n") : "";
                  const resultStr =
                    code !== 0
                      ? `Error (Exit Code ${code})\nStderr: ${stderrStr}\nStdout: ${stdoutStr}`
                      : `Stdout:\n${stdoutStr}\nStderr:\n${stderrStr}`;

                  currentSession.messages.push({
                    role: "system",
                    content: `[TOOL_RESULT] Command execution finished.\nResult:\n${resultStr}`,
                  });
                  saveSession(msg.sessionId, currentSession);

                  activeAbortController = new AbortController();
                  await askAgent({
                    workspaceRoot: cwd,
                    workspaceFiles: listWorkspaceFiles(),
                    question: "Command execution finished. Proceed.",
                    executePlan: true,
                    sessionId: msg.sessionId,
                    model: msg.model,
                    provider: msg.provider,
                    signal: activeAbortController.signal,
                    onStatus: (status) =>
                      panel.webview.postMessage({ type: "status", status }),
                    onChunk: (partialReply) =>
                      panel.webview.postMessage({
                        type: "partialReply",
                        sessionId: msg.sessionId,
                        content: partialReply,
                      }),
                    onFileWrite: async ({ filePath, code, isNew }) => {
                      try {
                        await writeAndSync(filePath, code, panel);
                        panel.webview.postMessage({
                          type: "fileAutoWritten",
                          filePath,
                          isNew,
                        });
                      } catch (e) {}
                    },
                  });
                  activeAbortController = null;
                  panel.webview.postMessage({
                    type: "sessionsLoaded",
                    sessions: getAllSessions(),
                  });
                  panel.webview.postMessage({
                    type: "reply",
                    sessionId: msg.sessionId,
                    session: getAllSessions()[msg.sessionId],
                  });
                }
              });
            }

            panel.webview.postMessage({
              type: "sessionsLoaded",
              sessions: getAllSessions(),
            });
          } catch (err) {
            vscode.window.showErrorMessage("Terminal error: " + err.message);
          }
          break;
        }

        case "declineTerminalCommand": {
          const sessions = getAllSessions();
          const session = sessions[msg.sessionId];
          if (session && session.messages[msg.messageIndex]) {
            const commands =
              session.messages[msg.messageIndex].suggestedCommands;
            if (commands && commands[msg.commandIndex]) {
              commands[msg.commandIndex].status = "declined";
              session.messages.push({
                role: "system",
                content: `[TOOL VERIFICATION] User DECLINED terminal command: ${commands[msg.commandIndex].command}`,
              });
              saveSession(msg.sessionId, session);
            }
          }
          panel.webview.postMessage({
            type: "sessionsLoaded",
            sessions: getAllSessions(),
          });
          break;
        }

        case "clearAllSessions": {
          clearAllSessions();
          break;
        }

        case "viewDiff": {
          try {
            const fs = require("fs");
            const os = require("os");
            const path = require("path");

            const originalPath = path.resolve(getWorkspaceRoot(), msg.filePath);
            const isNew = msg.isNew;
            const originalCode = msg.originalCode || "";
            const proposedCode = msg.proposedCode || "";

            // Create temp files for comparison
            const tempOriginal = path.join(
              os.tmpdir(),
              "jarvix_orig_" + path.basename(msg.filePath),
            );
            const tempProposed = path.join(
              os.tmpdir(),
              "jarvix_prop_" + path.basename(msg.filePath),
            );

            fs.writeFileSync(tempOriginal, originalCode, "utf8");
            fs.writeFileSync(tempProposed, proposedCode, "utf8");

            const title = isNew
              ? `Proposed New File: ${msg.filePath}`
              : `Proposed Edit: ${msg.filePath}`;

            vscode.commands.executeCommand(
              "vscode.diff",
              vscode.Uri.file(tempOriginal),
              vscode.Uri.file(tempProposed),
              title,
            );
          } catch (err) {
            vscode.window.showErrorMessage(
              "Failed to open diff: " + err.message,
            );
          }
          break;
        }
        // ── Runtime control messages ──────────────────────────────────────────
        case "runtimePause": {
          // The runtime reference is stored on args._runtime inside askAgent
          // We send a special status so the UI knows we're pausing
          panel.webview.postMessage({
            type: "EXECUTION_PROGRESS",
            sessionId: msg.sessionId,
            event: "RUNTIME_PAUSE_REQUESTED",
            timestamp: Date.now(),
          });
          // The runtime will honour the pause signal on next step boundary
          break;
        }

        case "runtimeResume": {
          panel.webview.postMessage({
            type: "EXECUTION_PROGRESS",
            sessionId: msg.sessionId,
            event: "RUNTIME_RESUMED",
            timestamp: Date.now(),
          });
          break;
        }

        case "runtimeAbort": {
          if (activeAbortController) {
            activeAbortController.abort();
            activeAbortController = null;
          }
          panel.webview.postMessage({
            type: "EXECUTION_PROGRESS",
            sessionId: msg.sessionId,
            event: "RUNTIME_ABORTED",
            timestamp: Date.now(),
          });
          panel.webview.postMessage({ type: "generationStopped" });
          break;
        }
      }
    });

    // ─── Sync session storage when user edits files directly ──────────────
    vscode.workspace.onDidSaveTextDocument((document) => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) return;
      const root = workspaceFolders[0].uri.fsPath;
      const filePath = document.fileName;
      if (!filePath.startsWith(root)) return;
      const content = document.getText();
      const relativePath = path.relative(root, filePath).replace(/\\/g, "/");

      // Prevent RAG drift by indexing the file on save
      try {
        const indexer = require("./src/indexer/RepositoryIndexer");
        indexer
          .indexFile(filePath)
          .catch((e) => console.warn("Indexer error:", e.message));
      } catch (e) {}

      panel.webview.postMessage({
        type: "fileChanged",
        filePath: relativePath,
        content,
      });
    });
  });

  context.subscriptions.push(command);
}

function deactivate() {}
module.exports = { activate, deactivate };
