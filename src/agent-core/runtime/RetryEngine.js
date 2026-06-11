/**
 * RetryEngine.js
 * Handles intelligent, adaptive retry logic for failed tasks.
 *
 * Key design decisions (per user review):
 *   - Max 3 attempts: attempt 1 = standard, 2 = self-correct, 3 = alternative strategy
 *   - Backoff: exponential for network/API, immediate for logic/file errors
 *   - Memory of Failed Approaches: never tries the same broken fix twice
 *
 * Part of the Jarvix 4.0 Task Execution Runtime.
 */

const { classifyFailure } = require('../reflection');
const { callLLM }         = require('../llmClient');

// Categorise errors into retry families
const RETRY_FAMILY = {
  NETWORK:     'NETWORK',    // rate limit, timeout, connection → exponential backoff
  LOGIC:       'LOGIC',      // syntax, reference, type → immediate + LLM self-correct
  ENVIRONMENT: 'ENVIRONMENT', // missing file/module/command → immediate + alternative
  PERMISSION:  'PERMISSION', // eacces, eperm → escalate immediately (no retry)
  TIMEOUT:     'TIMEOUT',    // task ran too long → immediate fail
};

/**
 * Map a classifyFailure result + error text to a RETRY_FAMILY.
 */
function _family(errorText) {
  const t = (errorText || '').toLowerCase();
  if (t.includes('429') || t.includes('rate limit') || t.includes('etimedout') || t.includes('econnrefused')) {
    return RETRY_FAMILY.NETWORK;
  }
  if (t.includes('eperm') || t.includes('eacces') || t.includes('permission denied')) {
    return RETRY_FAMILY.PERMISSION;
  }
  if (t.includes('timed out') || t.includes('task timeout')) {
    return RETRY_FAMILY.TIMEOUT;
  }
  const cf = classifyFailure(errorText);
  if (cf === 'ENVIRONMENT_BLOCKING') return RETRY_FAMILY.ENVIRONMENT;
  if (cf === 'TOOL_ERROR')           return RETRY_FAMILY.LOGIC;
  if (cf === 'GOAL_CRITICAL')        return RETRY_FAMILY.LOGIC;
  return RETRY_FAMILY.LOGIC; // safe default
}

/**
 * Return how long to wait (ms) before the next attempt.
 * Network errors: exponential (500 → 2000 → 5000).
 * Everything else: 0 (immediate — the "backoff" is the LLM reflection time).
 */
function _backoffMs(family, attemptNumber) {
  if (family === RETRY_FAMILY.NETWORK) {
    const slots = [500, 2000, 5000];
    return slots[Math.min(attemptNumber - 1, slots.length - 1)];
  }
  return 0; // immediate for logic / environment errors
}

class RetryEngine {
  /**
   * @param {Object} args  - LLM + workspace args (model, provider, workspaceRoot, onStatus…)
   */
  constructor(args) {
    this.args = args;
  }

  /**
   * Decide the next action after a failure.
   *
   * @param {import('./TaskQueue').Task} task
   * @param {Object} execResult  - { success, stdout, stderr, exitCode }
   * @returns {Promise<{
   *   action: 'RETRY'|'ESCALATE'|'SKIP',
   *   adjustedStep?: Object,   // modified step for next attempt
   *   reason: string,
   *   backoffMs: number
   * }>}
   */
  async decide(task, execResult) {
    const errorText = execResult.stderr || execResult.stdout || 'Unknown error';
    const family    = _family(errorText);
    const attempt   = task.retryCount + 1; // after markFailed increments retryCount

    // ── Hard stops — escalate immediately ─────────────────────────────────────
    if (family === RETRY_FAMILY.PERMISSION) {
      return { action: 'ESCALATE', reason: 'PERMISSION_DENIED — manual fix required', backoffMs: 0 };
    }
    if (family === RETRY_FAMILY.TIMEOUT) {
      return { action: 'ESCALATE', reason: 'TASK_TIMEOUT — exceeded time limit', backoffMs: 0 };
    }

    // ── Budget check ─────────────────────────────────────────────────────────
    if (task.retryCount >= task.maxRetries) {
      return { action: 'ESCALATE', reason: `MAX_RETRIES_EXCEEDED (${task.maxRetries})`, backoffMs: 0 };
    }

    const backoffMs = _backoffMs(family, attempt);

    // ── Attempt 2: Self-correction via LLM ───────────────────────────────────
    if (attempt === 2) {
      if (this.args.onStatus) {
        this.args.onStatus(`[${new Date().toLocaleTimeString()}] 🔧 Self-correcting step (attempt 2)…`);
      }
      const adjusted = await this._selfCorrect(task, errorText);
      if (adjusted) {
        return { action: 'RETRY', adjustedStep: adjusted, reason: 'SELF_CORRECTED', backoffMs };
      }
    }

    // ── Attempt 3: Alternative strategy via LLM ───────────────────────────────
    if (attempt === 3) {
      if (this.args.onStatus) {
        this.args.onStatus(`[${new Date().toLocaleTimeString()}] 🔄 Trying alternative strategy (attempt 3)…`);
      }
      // Check if we've tried this approach before (prevents infinite correction loop)
      const sig = _errorSignature(errorText);
      if (task.failedApproaches.includes(sig)) {
        return { action: 'ESCALATE', reason: `APPROACH_EXHAUSTED — same error (${sig}) seen before`, backoffMs: 0 };
      }
      const alternative = await this._alternativeStrategy(task, errorText);
      if (alternative) {
        return { action: 'RETRY', adjustedStep: alternative, reason: 'ALTERNATIVE_STRATEGY', backoffMs };
      }
    }

    // ── Default: straight retry (attempt 1 or fallback) ──────────────────────
    return { action: 'RETRY', adjustedStep: task.step, reason: 'STANDARD_RETRY', backoffMs };
  }

  /**
   * Ask the LLM to look at the error and produce a corrected version of the step.
   * Attempt 2 strategy: "you tried X and got Y, fix it."
   *
   * @param {import('./TaskQueue').Task} task
   * @param {string} errorText
   * @returns {Promise<Object|null>}  corrected step or null if LLM fails
   */
  async _selfCorrect(task, errorText) {
    try {
      const prompt = `You are a code execution repair system.

FAILED STEP:
${JSON.stringify(task.step, null, 2)}

ERROR:
${errorText.slice(0, 800)}

PREVIOUS FAILED APPROACHES:
${task.failedApproaches.join(', ') || 'None'}

Output a corrected version of the step JSON that fixes the error. 
Keep the same tool name unless absolutely necessary.
Output ONLY valid JSON matching the original step schema. No explanation.`;

      let raw = '';
      await callLLM({
        messages: [{ role: 'user', content: prompt }],
        system: 'You are a JSON repair engine. Output ONLY a valid JSON object. No markdown fences.',
        model: this.args.model,
        provider: this.args.provider,
        onChunk: c => { raw += c; },
      });

      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (e) {
      console.warn('[RetryEngine] Self-correct LLM call failed:', e.message);
    }
    return null;
  }

  /**
   * Ask the LLM for a completely different approach to accomplish the same goal.
   * Attempt 3 strategy: "the original plan is broken, try a different tool/path."
   *
   * @param {import('./TaskQueue').Task} task
   * @param {string} errorText
   * @returns {Promise<Object|null>}
   */
  async _alternativeStrategy(task, errorText) {
    try {
      const prompt = `You are a code execution planning system.

GOAL OF FAILED STEP: ${task.step.action || task.step.tool}
ORIGINAL STEP: ${JSON.stringify(task.step, null, 2)}
ALL ERRORS ENCOUNTERED: ${task.failedApproaches.join(', ')}
LATEST ERROR: ${errorText.slice(0, 600)}

Design an ALTERNATIVE step that achieves the same goal using a different approach.
For example: if fs.writeFile failed, try creating a parent directory first.
Output ONLY a valid JSON step object. No markdown fences.`;

      let raw = '';
      await callLLM({
        messages: [{ role: 'user', content: prompt }],
        system: 'You are an alternative strategy planner. Output ONLY a valid JSON object.',
        model: this.args.model,
        provider: this.args.provider,
        onChunk: c => { raw += c; },
      });

      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (e) {
      console.warn('[RetryEngine] Alternative strategy LLM call failed:', e.message);
    }
    return null;
  }
}

/**
 * Collapse an error into a short signature (shared with TaskQueue).
 */
function _errorSignature(msg) {
  const m = (msg || '').toLowerCase();
  if (m.includes('enoent') || m.includes('no such file'))   return 'PATH_MISSING';
  if (m.includes('permission') || m.includes('eacces'))      return 'PERMISSION';
  if (m.includes('syntax') || m.includes('unexpected'))      return 'SYNTAX_ERROR';
  if (m.includes('rate limit') || m.includes('429'))         return 'RATE_LIMIT';
  if (m.includes('module not found') || m.includes('cannot find module')) return 'MODULE_MISSING';
  if (m.includes('timeout') || m.includes('timed out'))      return 'TIMEOUT';
  return m.replace(/[^a-z0-9]/g, '_').slice(0, 60);
}

module.exports = { RetryEngine, RETRY_FAMILY };
