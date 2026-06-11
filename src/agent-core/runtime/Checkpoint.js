/**
 * Checkpoint.js
 * Creates and restores point-in-time snapshots of the execution runtime state.
 * Integrates with RollbackManager for file-level safety.
 * Part of the Jarvix 4.0 Task Execution Runtime.
 */

const fs   = require('fs');
const path = require('path');

class Checkpoint {
  /**
   * @param {string} workspaceRoot  - Absolute path to the user's workspace
   * @param {Object} [rollbackManager] - Optional RollbackManager instance for file backups
   */
  constructor(workspaceRoot, rollbackManager = null) {
    this.workspaceRoot = workspaceRoot;
    this.rollbackManager = rollbackManager;

    this.checkpointDir = path.join(
      workspaceRoot || process.cwd(),
      '.jarvix',
      'checkpoints',
    );

    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
    }
  }

  /**
   * Save a checkpoint that captures:
   *  - The current TaskQueue state (completed/pending/failed)
   *  - The current step index
   *  - A list of files that are "in scope" for rollback
   *
   * Also triggers RollbackManager to snapshot the files BEFORE the NEXT
   * step modifies them — ensuring the ghost-filesystem problem is solved.
   *
   * @param {Object} params
   * @param {string}     params.planId          - Unique ID for this execution run
   * @param {Object}     params.queueSnapshot   - TaskQueue.serialize() output
   * @param {number}     params.currentStepIndex
   * @param {string[]}   params.filesToWatch    - Files the NEXT step will touch
   * @param {Object}     [params.extraState]    - Any extra key-value pairs to persist
   * @returns {string} checkpointId
   */
  save({ planId, queueSnapshot, currentStepIndex, filesToWatch = [], extraState = {} }) {
    const id = `chk_${planId}_step${currentStepIndex}_${Date.now()}`;

    // ── File safety: ask RollbackManager to snapshot the "about-to-be-modified" files ──
    let fileBackupId = null;
    if (this.rollbackManager && filesToWatch.length > 0) {
      try {
        fileBackupId = this.rollbackManager.createCheckpoint(planId, filesToWatch);
      } catch (e) {
        console.warn('[Checkpoint] RollbackManager snapshot failed:', e.message);
      }
    }

    const payload = {
      id,
      planId,
      currentStepIndex,
      queueSnapshot,
      fileBackupId,  // Link to the RollbackManager backup — golden thread for ghost-filesystem fix
      filesToWatch,
      extraState,
      savedAt: new Date().toISOString(),
    };

    const filePath = path.join(this.checkpointDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`[Checkpoint] Saved: ${id}`);
    return id;
  }

  /**
   * Load a checkpoint by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  load(id) {
    const filePath = path.join(this.checkpointDir, `${id}.json`);
    if (!fs.existsSync(filePath)) {
      console.warn(`[Checkpoint] Not found: ${id}`);
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      console.error('[Checkpoint] Failed to parse:', e.message);
      return null;
    }
  }

  /**
   * Restore the filesystem to the state captured in a checkpoint.
   * This calls RollbackManager.restoreCheckpoint() using the stored fileBackupId,
   * which reverts any files modified AFTER the checkpoint was saved.
   *
   * This directly solves the "Ghost Filesystem" problem: if step 6 fails and we
   * restore checkpoint after step 5, files written by step 6 are rolled back.
   *
   * @param {string} checkpointId
   * @returns {{ success: boolean, queueSnapshot: Object|null, stepIndex: number }}
   */
  restore(checkpointId) {
    const data = this.load(checkpointId);
    if (!data) return { success: false, queueSnapshot: null, stepIndex: 0 };

    // ── Revert files to the pre-step state captured by RollbackManager ──
    if (this.rollbackManager && data.fileBackupId) {
      const reverted = this.rollbackManager.restoreCheckpoint(data.fileBackupId);
      if (!reverted) {
        console.warn('[Checkpoint] File restore failed — filesystem may be inconsistent.');
      } else {
        console.log(`[Checkpoint] Files reverted to: ${data.fileBackupId}`);
      }
    }

    console.log(`[Checkpoint] Restored state from step ${data.currentStepIndex}`);
    return {
      success: true,
      queueSnapshot: data.queueSnapshot,
      stepIndex: data.currentStepIndex,
      extraState: data.extraState || {},
      savedAt: data.savedAt,
    };
  }

  /**
   * Returns the most recently saved checkpoint for a given planId.
   * @param {string} planId
   * @returns {string|null} checkpointId
   */
  getLatest(planId) {
    try {
      const files = fs.readdirSync(this.checkpointDir)
        .filter(f => f.startsWith(`chk_${planId}_`) && f.endsWith('.json'))
        .sort(); // ISO timestamp + step index sort naturally
      return files.length ? files[files.length - 1].replace('.json', '') : null;
    } catch {
      return null;
    }
  }

  /**
   * List all checkpoints for a given planId, newest first.
   * @param {string} planId
   * @returns {{ id: string, stepIndex: number, savedAt: string }[]}
   */
  listForPlan(planId) {
    try {
      return fs.readdirSync(this.checkpointDir)
        .filter(f => f.startsWith(`chk_${planId}_`) && f.endsWith('.json'))
        .sort()
        .reverse()
        .map(f => {
          const data = this.load(f.replace('.json', ''));
          return data
            ? { id: data.id, stepIndex: data.currentStepIndex, savedAt: data.savedAt }
            : null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Purge checkpoints older than `maxAgeMs` for a given planId.
   * Called at end of successful execution to keep disk clean.
   * @param {string} planId
   * @param {number} [maxAgeMs=3600000]  default 1 hour
   */
  purge(planId, maxAgeMs = 60 * 60_000) {
    const cutoff = Date.now() - maxAgeMs;
    try {
      fs.readdirSync(this.checkpointDir)
        .filter(f => f.startsWith(`chk_${planId}_`) && f.endsWith('.json'))
        .forEach(f => {
          const filePath = path.join(this.checkpointDir, f);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
          }
        });
    } catch (e) {
      console.warn('[Checkpoint] Purge error:', e.message);
    }
  }
}

module.exports = Checkpoint;
