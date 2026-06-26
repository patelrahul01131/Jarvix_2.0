const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('../tools/fileSystem');

class DBHealthManager {
  static getDBPath() {
    const root = getWorkspaceRoot();
    if (!root) return null;
    return path.join(root, '.jarvix', 'lancedb');
  }

  /**
   * Check if the database directory exists and seems structurally intact.
   * Returns { healthy: boolean, reason?: string }
   */
  static checkHealth() {
    const dbPath = this.getDBPath();
    if (!dbPath) return { healthy: false, reason: 'No workspace root' };

    if (!fs.existsSync(dbPath)) {
      return { healthy: false, reason: 'Database directory does not exist' };
    }

    try {
      // Basic heuristic: check if it's a directory
      const stat = fs.statSync(dbPath);
      if (!stat.isDirectory()) {
        return { healthy: false, reason: 'Database path is not a directory' };
      }

      // We can add more checks here (e.g., check for lockfiles or specific lance formats)
      // but if the directory exists and we can stat it, it's structurally ok at the OS level.
      return { healthy: true };
    } catch (err) {
      return { healthy: false, reason: `Failed to stat DB directory: ${err.message}` };
    }
  }

  /**
   * Safely wipe the DB directory. Used for corruption recovery or manual reset.
   */
  static async wipeDB() {
    const dbPath = this.getDBPath();
    if (!dbPath) return false;

    console.log(`[DBHealthManager] Wiping LanceDB directory at ${dbPath}`);
    try {
      if (fs.existsSync(dbPath)) {
        await fs.promises.rm(dbPath, { recursive: true, force: true });
      }
      
      const metaPath = path.join(path.dirname(dbPath), 'index_meta.json');
      if (fs.existsSync(metaPath)) {
        await fs.promises.rm(metaPath, { force: true });
      }

      return true;
    } catch (err) {
      console.error(`[DBHealthManager] Failed to wipe DB:`, err.message);
      return false;
    }
  }
}

module.exports = { DBHealthManager };
