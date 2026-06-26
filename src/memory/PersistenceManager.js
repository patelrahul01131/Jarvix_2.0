'use strict';

const fs = require('fs');

/**
 * PersistenceManager
 * Ensures atomic and guaranteed writes to disk, even during process exits or crashes.
 */
class PersistenceManager {
  constructor() {
    this.pendingWrites = new Map(); // filePath -> string
    this.writeTimers = new Map();   // filePath -> NodeJS.Timeout

    this._setupExitHooks();
  }

  _setupExitHooks() {
    const flushAll = () => this.flushSync();
    
    // Only register hooks once per process
    if (!global.__persistenceManagerHooksRegistered) {
      process.on('exit', flushAll);
      process.on('SIGINT', () => { flushAll(); process.exit(0); });
      process.on('SIGTERM', () => { flushAll(); process.exit(0); });
      process.on('uncaughtException', (err) => {
        console.error('[PersistenceManager] Uncaught exception:', err);
        flushAll();
        process.exit(1);
      });
      global.__persistenceManagerHooksRegistered = true;
    }
  }

  /**
   * Schedules a file write to happen soon, debouncing rapid writes.
   * Ensures write happens synchronously on process exit if still pending.
   */
  scheduleWrite(filePath, dataString, debounceMs = 150) {
    this.pendingWrites.set(filePath, dataString);

    if (this.writeTimers.has(filePath)) {
      clearTimeout(this.writeTimers.get(filePath));
    }

    this.writeTimers.set(
      filePath,
      setTimeout(() => {
        this.writeTimers.delete(filePath);
        this._writeAsync(filePath, dataString);
      }, debounceMs)
    );
  }

  async _writeAsync(filePath, dataString) {
    try {
      // Atomic write: write to temp file then rename
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tempPath, dataString, 'utf8');
      await fs.promises.rename(tempPath, filePath);
      this.pendingWrites.delete(filePath);
    } catch (e) {
      console.error(`[PersistenceManager] Failed to write ${filePath}:`, e.message);
    }
  }

  /**
   * Synchronously flush all pending writes.
   * Used during process exit.
   */
  flushSync() {
    for (const [filePath, dataString] of this.pendingWrites.entries()) {
      try {
        const tempPath = `${filePath}.tmp.sync`;
        fs.writeFileSync(tempPath, dataString, 'utf8');
        fs.renameSync(tempPath, filePath);
      } catch (e) {
        console.error(`[PersistenceManager] Failed sync flush for ${filePath}:`, e.message);
      }
    }
    this.pendingWrites.clear();
    for (const timer of this.writeTimers.values()) {
      clearTimeout(timer);
    }
    this.writeTimers.clear();
  }
}

// Singleton export
const persistenceManager = new PersistenceManager();
module.exports = { PersistenceManager, persistenceManager };
