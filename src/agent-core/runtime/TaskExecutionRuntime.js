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

const { TaskQueue, TASK_STATUS } = require('./TaskQueue');
const Checkpoint                  = require('./Checkpoint');
const { RetryEngine }             = require('./RetryEngine');
const Verifier                    = require('./Verifier');
const { runExecutor }             = require('../executor');
const RollbackManager             = require('../rollback_manager');

// ── Runtime execution states ───────────────────────────────────────────────────
const RUNTIME_STATE = {
  IDLE:      'IDLE',
  RUNNING:   'RUNNING',
  PAUSED:    'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
};

class TaskExecutionRuntime {
  /**
   * @param {Object}   args         - Same args object passed through askAgent/runAgentLoop
   * @param {Function} onProgress   - Callback for UI updates (see _emit)
   */
  constructor(args, onProgress) {
    this.args       = args;
    this.onProgress = onProgress || (() => {});

    // Core sub-systems
    const rollback      = new RollbackManager(args.workspaceRoot);
    this.checkpoint     = new Checkpoint(args.workspaceRoot, rollback);
    this.retryEngine    = new RetryEngine(args);
    this.verifier       = new Verifier(args.workspaceRoot);
    this.taskQueue      = new TaskQueue();

    // Runtime state
    this.state          = RUNTIME_STATE.IDLE;
    this.planId         = `plan_${Date.now()}`;
    this.currentTask    = null;
    this._pauseSignal   = false;   // Set to true by pauseAndModify()
    this._abortSignal   = false;   // Set to true by abort()
    this._pauseResolve  = null;    // Promise resolver for pause/resume handshake
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
      event:       'RUNTIME_START',
      planId:      this.planId,
      totalSteps:  steps.length,
      phases:      this._buildPhaseMap(steps),
    });

    let task;
    while ((task = this.taskQueue.dequeue()) !== null) {
      // ── Abort check ────────────────────────────────────────────────────────
      if (this._abortSignal) {
        this.state = RUNTIME_STATE.FAILED;
        this._emit({ event: 'RUNTIME_ABORTED' });
        return { success: false, completedSteps: this.taskQueue.doneCount, error: 'Aborted by user' };
      }

      // ── Pause/modify handshake ─────────────────────────────────────────────
      if (this._pauseSignal) {
        this.state = RUNTIME_STATE.PAUSED;
        this.taskQueue.markPaused(task);
        this._emit({ event: 'RUNTIME_PAUSED', pausedAtStep: task.stepIndex });
        await this._waitForResume();
        this.state = RUNTIME_STATE.RUNNING;
        // Re-dequeue (task was paused, not failed)
        task.status = TASK_STATUS.PENDING;
        this.taskQueue.queue.unshift(task); // Put back at head
        continue;
      }

      // ── Save checkpoint BEFORE executing this step ─────────────────────────
      const filesToWatch = this._filesToWatch(task.step);
      task.checkpointId = this.checkpoint.save({
        planId:          this.planId,
        queueSnapshot:   this.taskQueue.serialize(),
        currentStepIndex: task.stepIndex,
        filesToWatch,
        extraState: { currentPhase: task.step.phase || 'unknown' },
      });

      this._emitStepStart(task);

      // ── Execute with timeout guard ─────────────────────────────────────────
      let execResult;
      try {
        execResult = await this._executeWithTimeout(task);
      } catch (timeoutErr) {
        execResult = {
          success:  false,
          stdout:   '',
          stderr:   timeoutErr.message,
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
            event:     'RUNTIME_ESCALATE',
            failedStep: task.step,
            reason:    outcome.reason,
            retryCount: task.retryCount,
          });
          return {
            success:       false,
            completedSteps: this.taskQueue.doneCount,
            failedStep:    task.step,
            error:         outcome.reason,
          };
        }
        // If not escalating, the task was re-queued by RetryEngine — loop continues
      }
    }

    // ── All steps done ─────────────────────────────────────────────────────────
    this.state = RUNTIME_STATE.COMPLETED;
    this.checkpoint.purge(this.planId); // Clean up checkpoint files

    this._emit({
      event:          'RUNTIME_COMPLETE',
      completedSteps: this.taskQueue.doneCount,
      failedSteps:    this.taskQueue.failed.length,
    });

    return {
      success:        this.taskQueue.failed.length === 0,
      completedSteps: this.taskQueue.doneCount,
    };
  }

  /**
   * Pause execution after the current step finishes.
   * The user can then modify remaining queue items and call resume().
   */
  pauseAndModify() {
    this._pauseSignal = true;
    console.log('[TaskExecutionRuntime] Pause requested — will pause after current step.');
  }

  /**
   * Resume a paused runtime.
   * @param {Object[]} [modifiedSteps]  optional replacement for remaining queue
   */
  resume(modifiedSteps) {
    this._pauseSignal = false;
    if (modifiedSteps && modifiedSteps.length > 0) {
      // Replace remaining pending steps with the user's edits
      const pendingIds = this.taskQueue.queue
        .filter(t => t.status === TASK_STATUS.PENDING)
        .map(t => t.id);
      this.taskQueue.queue = this.taskQueue.queue.filter(
        t => !pendingIds.includes(t.id),
      );
      modifiedSteps.forEach((step, i) => {
        this.taskQueue.enqueue(step, this.taskQueue.doneCount + i, step.phaseIndex || 0);
      });
    }
    if (this._pauseResolve) {
      this._pauseResolve();
      this._pauseResolve = null;
    }
  }

  /**
   * Hard abort — stops execution immediately.
   */
  abort() {
    this._abortSignal = true;
    if (this._pauseResolve) this._pauseResolve(); // unblock any pause wait
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Execute a step with a timeout guard.
   * @param {import('./TaskQueue').Task} task
   * @returns {Promise<Object>} execResult
   */
  async _executeWithTimeout(task) {
    return new Promise((resolve, reject) => {
      let done = false;

      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error(`TASK_TIMEOUT: Step "${task.step.action || task.step.tool}" exceeded ${task.timeoutMs}ms`));
        }
      }, task.timeoutMs);

      runExecutor(task.step, { /* minimal context */ }, this.args)
        .then(result => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch(err => {
          if (!done) {
            done = true;
            clearTimeout(timer);
            resolve({
              success:  false,
              stdout:   '',
              stderr:   err.message,
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
    this.taskQueue.markFailed(task, execResult.stderr || execResult.stdout || '');

    // Ask RetryEngine for the next action
    const decision = await this.retryEngine.decide(task, execResult);

    this._emit({
      event:        'STEP_RETRY',
      stepIndex:    task.stepIndex,
      stepAction:   task.step.action || task.step.tool,
      retryCount:   task.retryCount,
      maxRetries:   task.maxRetries,
      retryReason:  decision.reason,
      backoffMs:    decision.backoffMs,
    });

    if (decision.action === 'ESCALATE') {
      return { escalate: true, reason: decision.reason };
    }

    // Apply the adjusted step if RetryEngine produced one
    if (decision.adjustedStep) {
      task.step = decision.adjustedStep;
    }

    // Apply backoff delay if needed
    if (decision.backoffMs > 0) {
      await new Promise(r => setTimeout(r, decision.backoffMs));
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
    return new Promise(resolve => {
      this._pauseResolve = resolve;
    });
  }

  /**
   * Extract the list of files that a step will touch (for checkpoint + rollback).
   * @param {Object} step
   * @returns {string[]}
   */
  _filesToWatch(step) {
    if (!step?.input?.path) return [];
    const writingTools = ['fs.writeFile', 'fs.editFile', 'fs.deleteFile'];
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
      const phase = step.phase || 'Execution';
      if (!phaseMap.has(phase)) {
        phaseMap.set(phase, { name: phase, steps: [], startIndex: i });
      }
      phaseMap.get(phase).steps.push({ index: i, action: step.action || step.tool });
    });
    return Array.from(phaseMap.values());
  }

  // ── Event emitters (all go to the onProgress callback → UI) ──────────────────

  _emit(payload) {
    try {
      this.onProgress({
        planId:    this.planId,
        timestamp: Date.now(),
        ...payload,
      });
    } catch (e) {
      // Never crash the runtime due to UI errors
      console.warn('[TaskExecutionRuntime] onProgress error:', e.message);
    }
  }

  _emitStepStart(task) {
    if (this.args.onStatus) {
      this.args.onStatus(
        `[${new Date().toLocaleTimeString()}] ⚙️ Step ${task.stepIndex + 1}: ${task.step.action || task.step.tool}`,
      );
    }
    this._emit({
      event:      'STEP_START',
      stepIndex:  task.stepIndex,
      stepAction: task.step.action || task.step.tool,
      tool:       task.step.tool,
      phase:      task.step.phase,
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
      event:          'STEP_DONE',
      stepIndex:      task.stepIndex,
      stepAction:     task.step.action || task.step.tool,
      completedCount: this.taskQueue.doneCount,
      checkpointId:   task.checkpointId,
      checkpointedAt: new Date().toISOString(),
    });
  }

  _emitVerification(task, verification) {
    this._emit({
      event:      'STEP_VERIFIED',
      stepIndex:  task.stepIndex,
      passed:     verification.passed,
      checks:     verification.checks,
      issues:     verification.issues,
    });
  }
}

module.exports = { TaskExecutionRuntime, RUNTIME_STATE };
