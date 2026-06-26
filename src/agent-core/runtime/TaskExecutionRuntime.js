/**
 * TaskExecutionRuntime.js
 * The core orchestrator for Jarvix 4.0's Task Execution Runtime.
 *
 * Replaces the naive `for (step of loadedPlanSteps)` loop in loop.js with a
 * production-grade engine that:
 *   - Checkpoints state before each step
 *   - Verifies outcomes after each step
 *   - Retries intelligently (self-correct → alternative strategy → escalate)
 *   - Supports pauseAndModify() for mid-flight user edits
 *   - Emits rich progress events for the UI TaskExecutionPanel
 *
 * Part of the Jarvix 4.0 Task Execution Runtime.
 */

const { TaskQueue, TASK_STATUS } = require("./TaskQueue");
const Checkpoint = require("./Checkpoint");
const { RetryEngine } = require("./RetryEngine");
const Verifier = require("./Verifier");
const { runExecutor } = require("../executor");
const RollbackManager = require("../rollback_manager");

class PauseManager {
  constructor() {
    this.waiters = [];
    this.isPaused = false;
  }
  pause() {
    this.isPaused = true;
  }
  resume() {
    this.isPaused = false;
    const currentWaiters = [...this.waiters];
    this.waiters = [];
    currentWaiters.forEach(resolve => resolve());
  }
  waitForResume() {
    return new Promise(resolve => {
      if (!this.isPaused) {
        resolve();
      } else {
        this.waiters.push(resolve);
      }
    });
  }
}


// ── Runtime execution states ───────────────────────────────────────────────────
const RUNTIME_STATE = {
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
};

class TaskExecutionRuntime {
  /**
   * @param {Object}   args         - Same args object passed through askAgent/runAgentLoop
   * @param {Function} onProgress   - Callback for UI updates (see _emit)
   */
  constructor(args, onProgress) {
    this.args = args;
    this.onProgress = onProgress || (() => {});

    // Core sub-systems
    const rollback = new RollbackManager(args.workspaceRoot);
    this.checkpoint = new Checkpoint(args.workspaceRoot, rollback);
    this.retryEngine = new RetryEngine(args);
    this.verifier = new Verifier(args.workspaceRoot);
    this.taskQueue = new TaskQueue();

    // Runtime state
    this.state = RUNTIME_STATE.IDLE;
    this.planId = `plan_${Date.now()}`;
    this.currentTask = null;
    this.pauseManager = new PauseManager();
    this._pauseSignal = false; // Set to true by pauseAndModify()
    this._abortSignal = false; // Set to true by abort()
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Execute a full plan (array of steps from the approved plan).
   *
   * @param {Object[]} steps  - The `loadedPlanSteps` array from loop.js
   * @returns {Promise<{ success: boolean, completedSteps: number, failedStep?: Object, error?: string }>}
   */
  async execute(steps) {
    if (!steps || steps.length === 0) {
      return { success: true, completedSteps: 0 };
    }

    // Load steps into the queue
    this.taskQueue.loadPlan(steps);
    this.state = RUNTIME_STATE.RUNNING;

    this._emit({
      event: "RUNTIME_START",
      planId: this.planId,
      totalSteps: steps.length,
      phases: this._buildPhaseMap(steps),
    });

    let task;
    while ((task = this.taskQueue.dequeue()) !== null) {
      // ── Abort check ────────────────────────────────────────────────────────
      if (this._abortSignal) {
        this.state = RUNTIME_STATE.FAILED;
        this._emit({ event: "RUNTIME_ABORTED" });
        return {
          success: false,
          completedSteps: this.taskQueue.doneCount,
          error: "Aborted by user",
        };
      }

      // ── Handle Previously Resolved Tasks (Batched) ─────────────────────────
      if (task._resolvedStatus === "declined") {
        task.status = TASK_STATUS.COMPLETED;
        this.taskQueue.markDone(task);
        this._emitStepDone(task);
        continue;
      } else if (task._resolvedStatus === "accepted") {
        task.status = TASK_STATUS.COMPLETED;
        this.taskQueue.markDone(task);
        this._emitStepDone(task);
        continue;
      }

      // ── Pause/modify handshake ─────────────────────────────────────────────
      if (this._pauseSignal) {
        this.state = RUNTIME_STATE.PAUSED;
        this.taskQueue.markPaused(task);
        this._emit({ event: "RUNTIME_PAUSED", pausedAtStep: task.stepIndex });
        await this._waitForResume();
        this.state = RUNTIME_STATE.RUNNING;
        // Re-dequeue (task was paused, not failed)
        task.status = TASK_STATUS.PENDING;
        this.taskQueue.queue.unshift(task); // Put back at head
        continue;
      }

      // ── File Permission Pause ──────────────────────────────────────────────
      const writingTools = [
        "fs.writeFile",
        "fs.createFile",
        "fs.editFile",
        "fs.editFileLines",
        "fs.deleteFile",
      ];
      if (
        writingTools.includes(task.step.tool) &&
        !task.approved &&
        !this.args.autoExecute
      ) {
        // Put task back at the head of the queue since we are batching
        this.taskQueue.queue.unshift(task);

        // Batch contiguous file writes
        const batchedTasks = [];
        let peekIndex = 0;
        while (peekIndex < this.taskQueue.queue.length) {
          const nextTask = this.taskQueue.queue[peekIndex];
          if (writingTools.includes(nextTask.step.tool) && !nextTask.approved) {
            batchedTasks.push(nextTask);
            peekIndex++;
          } else {
            break;
          }
        }

        const sess = require("../../memory/shortTerm").getSession(
          this.args.sessionId,
        );
        if (sess) {
          const fileEdits = [];
          const fs = require("fs");
          const path = require("path");

          const fileEditsMap = {};

          for (const bTask of batchedTasks) {
            let newCode = "";
            let originalCode = "";
            const fullPath = path.resolve(
              this.args.workspaceRoot,
              bTask.step.input.path,
            );

            if (fileEditsMap[fullPath] !== undefined) {
              originalCode = fileEditsMap[fullPath].newCode;
            } else if (fs.existsSync(fullPath)) {
              originalCode = fs.readFileSync(fullPath, "utf-8");
            }

            if (bTask.step.tool === "fs.writeFile") {
              newCode = bTask.step.input.content || "";
            } else if (bTask.step.tool === "fs.editFileLines") {
              const lines = originalCode.split("\n");
              const start = Math.max(0, (bTask.step.input.startLine || 1) - 1);
              const end = Math.min(
                lines.length,
                bTask.step.input.endLine || lines.length,
              );
              const replacementLines = (bTask.step.input.newCode || "").split(
                "\n",
              );
              lines.splice(start, end - start, ...replacementLines);
              newCode = lines.join("\n");
            } else if (bTask.step.tool === "fs.editFile") {
              if (
                bTask.step.input.target &&
                bTask.step.input.replacement !== undefined
              ) {
                newCode = originalCode.replace(
                  bTask.step.input.target,
                  bTask.step.input.replacement,
                );
              } else {
                const lines = originalCode.split("\n");
                const startIdx = (bTask.step.input.startLine || 1) - 1;
                let endIdx = (bTask.step.input.endLine || lines.length) - 1;

                // Clamp endIdx to file length to prevent silent failures
                if (endIdx >= lines.length) endIdx = lines.length - 1;

                if (startIdx >= 0 && startIdx <= endIdx) {
                  newCode = [
                    ...lines.slice(0, startIdx),
                    bTask.step.input.replace !== undefined
                      ? bTask.step.input.replace
                      : bTask.step.input.replacement || "",
                    ...lines.slice(endIdx + 1),
                  ].join("\n");
                } else {
                  newCode = originalCode;
                }
              }
            }

            if (!fileEditsMap[fullPath]) {
              fileEditsMap[fullPath] = {
                originalCode: originalCode,
                newCode: newCode,
                isNew: bTask.step.tool === "fs.writeFile",
                isDelete: bTask.step.tool === "fs.deleteFile",
                tasks: [bTask],
              };
            } else {
              fileEditsMap[fullPath].newCode = newCode;
              if (bTask.step.tool === "fs.deleteFile")
                fileEditsMap[fullPath].isDelete = true;
              fileEditsMap[fullPath].tasks.push(bTask);
            }
          }

          for (const fullPath of Object.keys(fileEditsMap)) {
            const edit = fileEditsMap[fullPath];
            fileEdits.push({
              filePath: edit.tasks[0].step.input.path,
              newCode: edit.newCode,
              originalCode: edit.originalCode,
              isNew: edit.isNew,
              isDelete: edit.isDelete,
              status: "pending",
              _taskIndices: edit.tasks.map((t) => t.stepIndex),
            });
          }

          sess.messages.push({
            role: "assistant",
            content: `Proposed file actions`,
            isPlan: false,
            fileEdits: fileEdits,
          });
          require("../../memory/shortTerm").saveSession(
            this.args.sessionId,
            sess,
          );
          if (this.args.vscodePanel) {
            this.args.vscodePanel.webview.postMessage({
              type: "sessionsLoaded",
              sessions: require("../../memory/shortTerm").getAllSessions(),
            });
            this.args.vscodePanel.webview.postMessage({
              type: "reply",
              sessionId: this.args.sessionId,
              session: sess,
            });
          }
        }

        // Pause and wait for user to accept/decline files in UI
        this.taskQueue.markPaused(task);
        this.state = RUNTIME_STATE.PAUSED;
        this._emit({ event: "RUNTIME_PAUSED", pausedAtStep: task.stepIndex });

        await this._waitForResume();

        let activeSess = require("../../memory/shortTerm").getSession(
          this.args.sessionId,
        );
        let lastMsg = activeSess?.messages[activeSess.messages.length - 1];
        let pendingFiles = lastMsg?.fileEdits?.filter(
          (e) => e.status === "pending",
        );

        while (pendingFiles && pendingFiles.length > 0) {
          this.state = RUNTIME_STATE.PAUSED;
          await this._waitForResume();
          activeSess = require("../../memory/shortTerm").getSession(
            this.args.sessionId,
          );
          lastMsg = activeSess?.messages[activeSess.messages.length - 1];
          pendingFiles = lastMsg?.fileEdits?.filter(
            (e) => e.status === "pending",
          );
        }

        this.state = RUNTIME_STATE.RUNNING;

        // Apply statuses back to tasks
        if (lastMsg?.fileEdits) {
          for (const edit of lastMsg.fileEdits) {
            if (edit._taskIndices) {
              for (const idx of edit._taskIndices) {
                const bTask = batchedTasks.find((t) => t.stepIndex === idx);
                if (bTask) bTask._resolvedStatus = edit.status;
              }
            }
          }
        }

        for (const bTask of batchedTasks) {
          bTask.approved = true;
        }

        // Loop continues, which will dequeue the first batched task normally
        continue;
      }

      // Check for resolved status from a previous file permission block
      if (task._resolvedStatus === "declined") {
        // Skip execution on decline
        task.status = TASK_STATUS.COMPLETED;
        this.taskQueue.markDone(task);
        this._emitStepDone(task);
        continue;
      } else if (task._resolvedStatus === "accepted") {
        // The extension.js has ALREADY applied the file write!
        // Skip execution to avoid redundant writes
        task.status = TASK_STATUS.COMPLETED;
        this.taskQueue.markDone(task);
        this._emitStepDone(task);
        continue;
      }

      // ── Save checkpoint BEFORE executing this step ─────────────────────────
      const filesToWatch = this._filesToWatch(task.step);
      task.checkpointId = this.checkpoint.save({
        planId: this.planId,
        queueSnapshot: this.taskQueue.serialize(),
        currentStepIndex: task.stepIndex,
        filesToWatch,
        extraState: { currentPhase: task.step.phase || "unknown" },
      });

      this._emitStepStart(task);

      // ── Execute with timeout guard ─────────────────────────────────────────
      let execResult;
      try {
        execResult = await this._executeWithTimeout(task);
      } catch (timeoutErr) {
        execResult = {
          success: false,
          stdout: "",
          stderr: timeoutErr.message,
          exitCode: 124, // POSIX timeout exit code
        };
      }

      // ── Verify outcome ─────────────────────────────────────────────────────
      const verification = this.verifier.verify(task, execResult);
      this._emitVerification(task, verification);

      if (verification.passed) {
        // ✅ Step succeeded
        this.taskQueue.markDone(task);
        this._emitStepDone(task);
      } else {
        // ❌ Step failed — enter retry loop
        const outcome = await this._handleFailure(task, execResult);
        if (outcome.escalate) {
          this.state = RUNTIME_STATE.FAILED;
          this._emit({
            event: "RUNTIME_ESCALATE",
            failedStep: task.step,
            reason: outcome.reason,
            retryCount: task.retryCount,
          });
          return {
            success: false,
            completedSteps: this.taskQueue.doneCount,
            failedStep: task.step,
            error: outcome.reason,
          };
        }
        // If not escalating, the task was re-queued by RetryEngine — loop continues
      }
    }

    // ── All steps done ─────────────────────────────────────────────────────────
    this.state = RUNTIME_STATE.COMPLETED;
    this.checkpoint.purge(this.planId); // Clean up checkpoint files

    this._emit({
      event: "RUNTIME_COMPLETE",
      completedSteps: this.taskQueue.doneCount,
      failedSteps: this.taskQueue.failed.length,
    });

    return {
      success: this.taskQueue.failed.length === 0,
      completedSteps: this.taskQueue.doneCount,
    };
  }

  /**
   * Pause execution after the current step finishes.
   * The user can then modify remaining queue items and call resume().
   */
  pauseAndModify() {
    this._pauseSignal = true;
    console.log(
      "[TaskExecutionRuntime] Pause requested — will pause after current step.",
    );
  }

  /**
   * Resume a paused runtime.
   * @param {Object[]} [modifiedSteps]  optional replacement for remaining queue
   * @param {string} [actionStatus]     "accepted" or "declined"
   */
  resume(modifiedSteps, actionStatus) {
    this._pauseSignal = false;
    this._resumeActionStatus = actionStatus;
    if (modifiedSteps && modifiedSteps.length > 0) {
      // Replace remaining pending steps with the user's edits
      const pendingIds = new Set(this.taskQueue.queue
        .filter((t) => t.status === TASK_STATUS.PENDING)
        .map((t) => t.id));
      this.taskQueue.queue = this.taskQueue.queue.filter(
        (t) => !pendingIds.has(t.id),
      );
      modifiedSteps.forEach((step, i) => {
        this.taskQueue.enqueue(
          step,
          this.taskQueue.doneCount + i,
          step.phaseIndex || 0,
        );
      });
    }
    this.pauseManager.resume();
  }

  /**
   * Hard abort — stops execution immediately.
   */
  abort() {
    this._abortSignal = true;
    this.pauseManager.resume(); // unblock any pause wait
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Execute a step with a timeout guard and transactional rollback for files.
   * @param {import('./TaskQueue').Task} task
   * @returns {Promise<Object>} execResult
   */
  async _executeWithTimeout(task) {
    const fs = require("fs");
    const path = require("path");

    // 1. Transactional Backup Phase
    const isFileEdit = [
      "fs.writeFile",
      "fs.editFile",
      "fs.editFileLines",
    ].includes(task.step.tool);
    let backupContent = null;
    let targetPath = null;
    let backupCreated = false;

    if (isFileEdit && task.step.input && task.step.input.path) {
      targetPath = path.resolve(this.args.workspaceRoot, task.step.input.path);
      if (fs.existsSync(targetPath)) {
        backupContent = fs.readFileSync(targetPath, "utf-8");
        backupCreated = true;
      }
    }

    return new Promise((resolve, reject) => {
      let done = false;

      // 2. Local AbortController to stop executor immediately on timeout
      const controller = new AbortController();
      const stepArgs = { ...this.args, signal: controller.signal };

      // 3. AbortSignal Listener for Safe Rollback
      const abortHandler = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          controller.abort(new Error(`TASK_ABORTED`));

          if (backupCreated && targetPath) {
            try {
              fs.writeFileSync(targetPath, backupContent, "utf-8");
              console.log(
                `[TransactionRollback] Restored original content for ${targetPath}`,
              );
            } catch (e) {
              console.error(
                `[TransactionRollback] Failed to restore ${targetPath}:`,
                e,
              );
            }
          }

          reject(
            new Error(
              `TASK_ABORTED: Step "${task.step.action || task.step.tool}" was aborted due to Timeout or Graph limits.`,
            ),
          );
        }
      };

      if (this.args.signal) {
        this.args.signal.addEventListener("abort", abortHandler);
      }

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          controller.abort(new Error(`TASK_TIMEOUT`));
          if (this.args.signal)
            this.args.signal.removeEventListener("abort", abortHandler);
          reject(
            new Error(
              `TASK_TIMEOUT: Step "${task.step.action || task.step.tool}" exceeded ${task.timeoutMs}ms`,
            ),
          );
        }
      }, task.timeoutMs);

      runExecutor(
        task.step,
        {
          /* minimal context */
        },
        stepArgs,
      )
        .then((result) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            if (this.args.signal)
              this.args.signal.removeEventListener("abort", abortHandler);
            resolve(result);
          }
        })
        .catch((err) => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            if (this.args.signal)
              this.args.signal.removeEventListener("abort", abortHandler);
            resolve({
              success: false,
              stdout: "",
              stderr: err.message,
              exitCode: 1,
            });
          }
        });
    });
  }

  /**
   * Handle a failed step: determine retry action and either re-queue or escalate.
   * @param {import('./TaskQueue').Task} task
   * @param {Object} execResult
   * @returns {Promise<{ escalate: boolean, reason: string }>}
   */
  async _handleFailure(task, execResult) {
    // Record the failure in the queue first (increments retryCount + failedApproaches)
    this.taskQueue.markFailed(
      task,
      execResult.stderr || execResult.stdout || "",
    );

    // Ask RetryEngine for the next action
    const decision = await this.retryEngine.decide(task, execResult);

    this._emit({
      event: "STEP_RETRY",
      stepIndex: task.stepIndex,
      stepAction: task.step.action || task.step.tool,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      retryReason: decision.reason,
      backoffMs: decision.backoffMs,
    });

    if (decision.action === "ESCALATE") {
      return { escalate: true, reason: decision.reason };
    }

    // Apply the adjusted step if RetryEngine produced one
    if (decision.adjustedStep) {
      task.step = decision.adjustedStep;
    }

    // Apply backoff delay if needed
    if (decision.backoffMs > 0) {
      await new Promise((r) => setTimeout(r, decision.backoffMs));
    }

    // Restore from checkpoint to undo any partial filesystem changes
    if (task.checkpointId) {
      this.checkpoint.restore(task.checkpointId);
    }

    // Task is already back to PENDING (markFailed did that) — loop will pick it up
    return { escalate: false, reason: decision.reason };
  }

  /**
   * Wait until resume() is called.
   * @returns {Promise<void>}
   */
  _waitForResume() {
    this.pauseManager.pause();
    return this.pauseManager.waitForResume();
  }

  /**
   * Extract the list of files that a step will touch (for checkpoint + rollback).
   * @param {Object} step
   * @returns {string[]}
   */
  _filesToWatch(step) {
    if (!step?.input?.path) return [];
    const writingTools = [
      "fs.writeFile",
      "fs.editFile",
      "fs.editFileLines",
      "fs.deleteFile",
    ];
    if (writingTools.includes(step.tool)) return [step.input.path];
    return [];
  }

  /**
   * Build a UI-friendly phase map from the flat steps array.
   * Groups steps by their `phase` field.
   * @param {Object[]} steps
   * @returns {Object[]} phases
   */
  _buildPhaseMap(steps) {
    const phaseMap = new Map();
    steps.forEach((step, i) => {
      const phase = step.phase || "Execution";
      if (!phaseMap.has(phase)) {
        phaseMap.set(phase, { name: phase, steps: [], startIndex: i });
      }
      phaseMap
        .get(phase)
        .steps.push({ index: i, action: step.action || step.tool });
    });
    return Array.from(phaseMap.values());
  }

  // ── Event emitters (all go to the onProgress callback → UI) ──────────────────

  _emit(payload) {
    try {
      this.onProgress({
        planId: this.planId,
        timestamp: Date.now(),
        ...payload,
      });
    } catch (e) {
      // Never crash the runtime due to UI errors
      console.warn("[TaskExecutionRuntime] onProgress error:", e.message);
    }
  }

  _emitStepStart(task) {
    if (this.args.onStatus) {
      this.args.onStatus(
        `[${new Date().toLocaleTimeString()}] ⚙️ Step ${task.stepIndex + 1}: ${task.step.action || task.step.tool}`,
      );
    }
    this._emit({
      event: "STEP_START",
      stepIndex: task.stepIndex,
      stepAction: task.step.action || task.step.tool,
      tool: task.step.tool,
      phase: task.step.phase,
      retryCount: task.retryCount,
    });
  }

  _emitStepDone(task) {
    if (this.args.onStatus) {
      this.args.onStatus(
        `[${new Date().toLocaleTimeString()}] ✅ Step ${task.stepIndex + 1} complete`,
      );
    }
    this._emit({
      event: "STEP_DONE",
      stepIndex: task.stepIndex,
      stepAction: task.step.action || task.step.tool,
      completedCount: this.taskQueue.doneCount,
      checkpointId: task.checkpointId,
      checkpointedAt: new Date().toISOString(),
    });
  }

  _emitVerification(task, verification) {
    this._emit({
      event: "STEP_VERIFIED",
      stepIndex: task.stepIndex,
      passed: verification.passed,
      checks: verification.checks,
      issues: verification.issues,
    });
  }
}

module.exports = { TaskExecutionRuntime, RUNTIME_STATE };
