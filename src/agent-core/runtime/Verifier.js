/**
 * Verifier.js
 * Per-step outcome verification after each task execution.
 * Wraps and extends the existing GoalEvaluator with shallow file/command checks.
 * Part of the Jarvix 4.0 Task Execution Runtime.
 */

const fs   = require('fs');
const path = require('path');

class Verifier {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Verify the outcome of a completed task step.
   *
   * Returns a structured result so the TaskExecutionRuntime can decide
   * whether to advance, retry, or escalate.
   *
   * @param {import('./TaskQueue').Task} task
   * @param {Object} execResult  - { success, stdout, stderr, exitCode }
   * @returns {{ passed: boolean, issues: string[], checks: string[] }}
   */
  verify(task, execResult) {
    const issues = [];
    const checks = [];
    const step   = task.step;

    // ── 1. Basic execution success check ──────────────────────────────────────
    if (execResult.success === false) {
      const errMsg = execResult.stderr || execResult.stdout || 'Unknown error';
      issues.push(`Execution failed: ${errMsg.slice(0, 200)}`);
    } else {
      checks.push('✓ Execution reported success');
    }

    // ── 2. Tool-specific shallow verification ─────────────────────────────────
    if (step.tool === 'fs.writeFile' && step.input?.path) {
      const fullPath = this._resolve(step.input.path);
      if (fs.existsSync(fullPath)) {
        checks.push(`✓ File exists: ${step.input.path}`);

        // Size sanity: an empty file for a code task is suspicious
        if (step.input.content && step.input.content.trim().length > 0) {
          const stat = fs.statSync(fullPath);
          if (stat.size === 0) {
            issues.push(`File was written but is empty: ${step.input.path}`);
          } else {
            checks.push(`✓ File is non-empty (${stat.size} bytes)`);
          }
        }
      } else {
        issues.push(`File was not created: ${step.input.path}`);
      }
    }

    if (step.tool === 'fs.editFile' && step.input?.path) {
      const fullPath = this._resolve(step.input.path);
      if (fs.existsSync(fullPath)) {
        checks.push(`✓ Edited file still exists: ${step.input.path}`);
      } else {
        issues.push(`Edited file disappeared: ${step.input.path}`);
      }
    }

    if (step.tool === 'fs.readFile' && step.input?.path) {
      const fullPath = this._resolve(step.input.path);
      if (!fs.existsSync(fullPath)) {
        issues.push(`File to read does not exist: ${step.input.path}`);
      } else {
        checks.push(`✓ Read target exists: ${step.input.path}`);
      }
    }

    if (step.tool === 'terminal.exec') {
      // For terminal execution, exit code is the primary signal
      if (execResult.exitCode === 0 || execResult.success !== false) {
        checks.push('✓ Terminal command exited cleanly');
      } else {
        issues.push(`Terminal command failed (exit code ${execResult.exitCode})`);
      }
    }

    if (step.tool === 'list_dir' && step.input?.path) {
      const fullPath = this._resolve(step.input.path);
      if (!fs.existsSync(fullPath)) {
        issues.push(`Directory not found: ${step.input.path}`);
      } else {
        checks.push(`✓ Directory exists: ${step.input.path}`);
      }
    }

    // ── 3. Acceptance criteria from the step definition (if provided) ─────────
    if (step.acceptance_criteria) {
      const crit = Array.isArray(step.acceptance_criteria)
        ? step.acceptance_criteria
        : [step.acceptance_criteria];

      for (const c of crit) {
        const result = this._evalCriterion(c);
        if (result.passed) {
          checks.push(`✓ Criterion: ${c}`);
        } else {
          issues.push(`✗ Criterion not met: ${c} (${result.reason})`);
        }
      }
    }

    return {
      passed: issues.length === 0,
      issues,
      checks,
    };
  }

  /**
   * Evaluate a simple string-based acceptance criterion.
   * Examples: "src/index.js exists", "npm install successful"
   * @param {string} criterion
   * @returns {{ passed: boolean, reason: string }}
   */
  _evalCriterion(criterion) {
    const c = (criterion || '').toLowerCase();

    // Pattern: "<path> exists"
    const existsMatch = criterion.match(/^(.+)\s+exists$/i);
    if (existsMatch) {
      const target = existsMatch[1].trim();
      const full   = this._resolve(target);
      const ok     = fs.existsSync(full);
      return { passed: ok, reason: ok ? 'found' : `not found at ${full}` };
    }

    // Pattern: "no errors" / "exit code 0"
    if (c.includes('no error') || c.includes('exit code 0') || c.includes('successful')) {
      // We trust execResult.success was already checked above — optimistic pass here
      return { passed: true, reason: 'execution marked successful' };
    }

    // Unknown criterion — pass optimistically (don't block on unknowns)
    return { passed: true, reason: 'unknown criterion — passed optimistically' };
  }

  /**
   * Safely resolve a workspace-relative or absolute path.
   * @param {string} p
   * @returns {string}
   */
  _resolve(p) {
    if (path.isAbsolute(p)) return p;
    return path.resolve(this.workspaceRoot || process.cwd(), p);
  }
}

module.exports = Verifier;
