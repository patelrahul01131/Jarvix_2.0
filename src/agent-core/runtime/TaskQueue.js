/**
 * TaskQueue.js
 * Wraps raw plan steps into tracked Task objects with retry/priority metadata.
 * Part of the Jarvix 4.0 Task Execution Runtime.
 */

const { v4: uuidv4 } = (() => {
  try { return require('crypto'); } catch { return { v4: () => `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }; }
})();

/**
 * Creates a unique task id without external deps.
 */
function makeId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Task status enum
const TASK_STATUS = {
  PENDING:   'PENDING',
  RUNNING:   'RUNNING',
  SUCCESS:   'SUCCESS',
  FAILED:    'FAILED',
  SKIPPED:   'SKIPPED',
  PAUSED:    'PAUSED',
};

/**
 * @typedef {Object} Task
 * @property {string}   id
 * @property {Object}   step              - Original plan step (tool, input, action, phase)
 * @property {number}   phaseIndex        - Which phase this step belongs to
 * @property {number}   stepIndex         - Global step index across all phases
 * @property {string}   priority          - 'critical' | 'high' | 'normal' | 'low'
 * @property {string}   status            - TASK_STATUS value
 * @property {number}   retryCount        - Number of attempts so far
 * @property {number}   maxRetries        - Maximum attempts allowed (default 3)
 * @property {number}   timeoutMs         - Max ms to wait for this task (default 5 min)
 * @property {string|null} checkpointId  - ID of checkpoint saved before this step
 * @property {string[]} failedApproaches  - Serialised error signatures tried so far (prevents loop)
 * @property {string|null} lastError      - Last error message
 * @property {number}   startedAt         - Unix ms when last attempt began
 * @property {number}   completedAt       - Unix ms when completed
 */

class TaskQueue {
  constructor() {
    /** @type {Task[]} */
    this.queue = [];
    this.completed = [];
    this.failed = [];
  }

  /**
   * Build a Task from a raw plan step and enqueue it.
   * @param {Object} step
   * @param {number} stepIndex
   * @param {number} phaseIndex
   * @param {Object} [opts]
   * @returns {Task}
   */
  enqueue(step, stepIndex, phaseIndex = 0, opts = {}) {
    const task = {
      id: makeId(),
      step,
      phaseIndex,
      stepIndex,
      priority: opts.priority || 'normal',
      status: TASK_STATUS.PENDING,
      retryCount: 0,
      maxRetries: opts.maxRetries ?? 3,
      // Terminal commands get a longer timeout (5 min); others 2 min.
      timeoutMs: opts.timeoutMs ?? (step.tool === 'terminal.exec' ? 5 * 60_000 : 2 * 60_000),
      checkpointId: null,
      failedApproaches: [],   // "memory of failed approaches"
      lastError: null,
      startedAt: 0,
      completedAt: 0,
    };
    this.queue.push(task);
    return task;
  }

  /**
   * Load multiple plan steps in order.
   * @param {Object[]} steps
   * @returns {Task[]}
   */
  loadPlan(steps) {
    return steps.map((step, i) => {
      // Detect terminal commands and give them higher timeout
      const isTerminal = step.tool === 'terminal.exec';
      return this.enqueue(step, i, step.phaseIndex || 0, {
        timeoutMs: isTerminal ? 5 * 60_000 : 2 * 60_000,
      });
    });
  }

  /**
   * Return the next pending task without removing it.
   * @returns {Task|null}
   */
  peek() {
    return this.queue.find(t => t.status === TASK_STATUS.PENDING) || null;
  }

  /**
   * Dequeue the next PENDING task and mark it RUNNING.
   * @returns {Task|null}
   */
  dequeue() {
    const task = this.queue.find(t => t.status === TASK_STATUS.PENDING);
    if (!task) return null;
    task.status = TASK_STATUS.RUNNING;
    task.startedAt = Date.now();
    return task;
  }

  /**
   * Mark a task as successfully completed.
   * @param {Task} task
   */
  markDone(task) {
    task.status = TASK_STATUS.SUCCESS;
    task.completedAt = Date.now();
    this.completed.push(task);
    // Remove from active queue
    this.queue = this.queue.filter(t => t.id !== task.id);
  }

  /**
   * Mark a task as failed and record the error.
   * Remembers the error signature so RetryEngine won't try it again.
   * @param {Task} task
   * @param {string} errorMessage
   */
  markFailed(task, errorMessage) {
    task.lastError = errorMessage;
    // Record error signature to prevent infinite correction loop
    const sig = _errorSignature(errorMessage);
    if (!task.failedApproaches.includes(sig)) {
      task.failedApproaches.push(sig);
    }
    task.retryCount += 1;

    if (task.retryCount >= task.maxRetries) {
      task.status = TASK_STATUS.FAILED;
      task.completedAt = Date.now();
      this.failed.push(task);
      this.queue = this.queue.filter(t => t.id !== task.id);
    } else {
      // Back to PENDING so it can be retried
      task.status = TASK_STATUS.PENDING;
    }
  }

  /**
   * Pause the current RUNNING task (for pauseAndModify support).
   * @param {Task} task
   */
  markPaused(task) {
    task.status = TASK_STATUS.PAUSED;
  }

  /**
   * Re-enqueue a paused task or replace a step's definition for mid-flight edits.
   * @param {Task} task
   * @param {Object} [newStep]  optional replacement step definition
   */
  resumeTask(task, newStep) {
    if (newStep) task.step = newStep;
    task.status = TASK_STATUS.PENDING;
    task.retryCount = 0;
    task.failedApproaches = [];
    task.lastError = null;
  }

  /**
   * Serialisable snapshot for Checkpoint.js.
   */
  serialize() {
    return {
      queue: this.queue,
      completed: this.completed,
      failed: this.failed,
    };
  }

  /**
   * Restore from a serialised snapshot.
   * @param {Object} data
   */
  restore(data) {
    this.queue = data.queue || [];
    this.completed = data.completed || [];
    this.failed = data.failed || [];
  }

  get pendingCount() { return this.queue.filter(t => t.status === TASK_STATUS.PENDING).length; }
  get totalCount()   { return this.queue.length + this.completed.length + this.failed.length; }
  get doneCount()    { return this.completed.length; }
}

/**
 * Collapse an error into a short signature string so we can detect
 * "same fix tried again" in failedApproaches.
 * @param {string} msg
 * @returns {string}
 */
function _errorSignature(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('enoent') || m.includes('no such file'))   return 'PATH_MISSING';
  if (m.includes('permission') || m.includes('eacces'))      return 'PERMISSION';
  if (m.includes('syntax') || m.includes('unexpected'))      return 'SYNTAX_ERROR';
  if (m.includes('rate limit') || m.includes('429'))         return 'RATE_LIMIT';
  if (m.includes('module not found') || m.includes('cannot find module')) return 'MODULE_MISSING';
  if (m.includes('timeout') || m.includes('timed out'))      return 'TIMEOUT';
  // Fallback: first 60 chars normalized
  return m.replace(/[^a-z0-9]/g, '_').slice(0, 60);
}

module.exports = { TaskQueue, TASK_STATUS };
