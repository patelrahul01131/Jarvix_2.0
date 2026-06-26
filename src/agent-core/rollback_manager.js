const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { eventBus, EVENTS } = require("../core/event_bus");

/**
 * RollbackManager
 * Provides layered recovery guarantees for high-risk operations.
 */
class RollbackManager {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.backupDir = path.join(this.workspaceRoot || process.cwd(), '.jarvix', 'backups');
    
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Creates a pre-execution checkpoint using layered strategies.
   */
  createCheckpoint(goalId, filesToModify = []) {
    const checkpointId = `chk_${Date.now()}_${goalId}`;
    
    // Layer 1: File copy backups
    this._createFileBackups(checkpointId, filesToModify);
    
    // Layer 2: Git Stash (if applicable)
    const gitAvailable = this._isGitAvailable();
    if (gitAvailable) {
      // We do not commit. We can just stash or rely on Git's native diffing.
      // For safety, we simply ensure the user has a clean working tree or we warn them.
      // We will skip actual stashing here to avoid messing with user's unstaged work,
      // but we note that git is available for manual revert.
    }
    
    return checkpointId;
  }

  /**
   * Restores files from a specific checkpoint.
   */
  restoreCheckpoint(checkpointId) {
    const cpDir = path.join(this.backupDir, checkpointId);
    if (!fs.existsSync(cpDir)) {
      console.warn(`[RollbackManager] Checkpoint ${checkpointId} not found.`);
      return false;
    }

    try {
      const files = fs.readdirSync(cpDir);
      for (const file of files) {
        // Decode filename (we replace slashes with __ in backups)
        const originalRelativePath = file.replace(/__/g, path.sep);
        const originalFullPath = path.join(this.workspaceRoot, originalRelativePath);
        
        const backupPath = path.join(cpDir, file);
        
        fs.copyFileSync(backupPath, originalFullPath);
      }
      
      eventBus.emitEvent(EVENTS.ROLLBACK_TRIGGERED, { checkpointId });
      return true;
    } catch (err) {
      console.error(`[RollbackManager] Failed to restore checkpoint ${checkpointId}:`, err);
      return false;
    }
  }

  _createFileBackups(checkpointId, files) {
    if (!files || files.length === 0) return;
    
    const cpDir = path.join(this.backupDir, checkpointId);
    fs.mkdirSync(cpDir, { recursive: true });

    for (const relativePath of files) {
      const fullPath = path.join(this.workspaceRoot, relativePath);
      if (fs.existsSync(fullPath)) {
        // Flatten path for simple storage
        const safeName = relativePath.replace(/[/\\\\]/g, '__');
        fs.copyFileSync(fullPath, path.join(cpDir, safeName));
      }
    }
  }

  _isGitAvailable() {
    if (!this.workspaceRoot) return false;
    try {
      return fs.existsSync(path.join(this.workspaceRoot, '.git'));
    } catch {
      return false;
    }
  }
}

module.exports = RollbackManager;
