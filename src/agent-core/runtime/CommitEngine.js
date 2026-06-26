// src/agent-core/runtime/CommitEngine.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class CommitEngine {
  constructor(options = {}) {
    this.lockManager = options.lockManager;
    this.di = options.diContainer;
  }

  async commit(transactionId, patches) {
    const stageDirs = [];
    const rollbackActions = [];
    const lockedFiles = [];

    try {
      // --- Phase 1: Validate & Lock ---
      for (const patch of patches) {
        // Enforce lock manager check
        this.lockManager.acquireLock(transactionId, patch.filePath);
        lockedFiles.push(patch.filePath);

        // Verify pre-execution hashes for conflict detection
        this.lockManager.verifyNoConflict(patch.filePath, patch.fileHashBefore);
      }

      // --- Phase 2: Stage / Write Temp ---
      const tempDir = path.join(process.env.JARVIX_WORKSPACE_ROOT || process.cwd(), ".jarvix", "stage", transactionId);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      stageDirs.push(tempDir);

      const stagedFiles = [];
      for (const patch of patches) {
        const stagedPath = path.join(tempDir, crypto.createHash("sha256").update(patch.filePath).digest("hex"));
        fs.writeFileSync(stagedPath, patch.contentAfter, "utf8");
        stagedFiles.push({
          targetPath: patch.filePath,
          stagedPath,
          contentBefore: patch.contentBefore,
          existsBefore: fs.existsSync(patch.filePath)
        });
      }

      // --- Phase 3: Atomic Rename & Release ---
      for (const fileInfo of stagedFiles) {
        // Store original for rollback
        rollbackActions.push({
          targetPath: fileInfo.targetPath,
          contentBefore: fileInfo.contentBefore,
          existsBefore: fileInfo.existsBefore
        });

        // Ensure parent directories exist
        const parentDir = path.dirname(fileInfo.targetPath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        // Perform the write (simulating atomic rename or fs write)
        fs.writeFileSync(fileInfo.targetPath, fs.readFileSync(fileInfo.stagedPath, "utf8"), "utf8");
      }

      // Cleanup stage directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {}

      return { success: true };
    } catch (err) {
      console.error(`[CommitEngine] Commit failed: ${err.message}. Initiating rollback.`);
      // Rollback Phase
      for (const action of rollbackActions) {
        try {
          if (action.existsBefore) {
            fs.writeFileSync(action.targetPath, action.contentBefore, "utf8");
          } else if (fs.existsSync(action.targetPath)) {
            fs.unlinkSync(action.targetPath);
          }
        } catch (rollbackErr) {
          console.error(`[CommitEngine] Critical Rollback Failure for ${action.targetPath}:`, rollbackErr.message);
        }
      }
      throw err;
    } finally {
      // Always release locks
      for (const file of lockedFiles) {
        this.lockManager.releaseLock(transactionId, file);
      }
    }
  }
}

module.exports = CommitEngine;
