const path = require("path");
const fs = require("fs");

/**
 * SQLite Database Manager
 * Handles the structured memory tables for Jarvix 4.0.
 */
class DatabaseManager {
  constructor(dbPath) {
    this._explicitDbPath = dbPath || null; // If provided at construction, use directly
    this.db = null;
    this._initialized = false;
  }

  _getDbPath() {
    if (this._explicitDbPath) return this._explicitDbPath;
    // Resolve workspace root lazily — by the time any query runs, workspace is open
    let root = process.env.JARVIX_WORKSPACE_ROOT || process.cwd();
    try {
      const { getWorkspaceRoot } = require("../tools/fileSystem");
      const wsRoot = getWorkspaceRoot();
      if (wsRoot) root = wsRoot;
    } catch (e) {
      // Fallback to env var / cwd
    }
    const dir = path.join(root, ".jarvix");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "memory.sqlite");
  }

  _ensureInit() {
    if (this._initialized) return;
    this._initialized = true;
    const dbPath = this._getDbPath();
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(dbPath, { verbose: null });
      this.db.pragma("journal_mode = WAL");
      this._initializeSchema();
    } catch (err) {
      console.warn(
        "[DatabaseManager] better-sqlite3 failed to load (likely ABI mismatch). Running without local SQLite memory.",
        err.message,
      );
      this.db = null;
    }
  }

  _initializeSchema() {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS beliefs (
        key TEXT PRIMARY KEY,
        current_value TEXT NOT NULL,
        confidence REAL NOT NULL,
        history_json TEXT,
        superseded_json TEXT,
        last_verified TEXT
      );

      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        parent_goal_id TEXT,
        title TEXT,
        status TEXT,
        dependencies_json TEXT,
        priority TEXT,
        confidence REAL,
        created_at TEXT,
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS failures (
        id TEXT PRIMARY KEY,
        strategy TEXT,
        reason TEXT,
        environment_json TEXT,
        observed_at TEXT,
        expires_at TEXT
      );

      CREATE TABLE IF NOT EXISTS journal_events (
        id TEXT PRIMARY KEY,
        goal_id TEXT,
        timestamp TEXT,
        action_json TEXT,
        before_state_json TEXT,
        after_state_json TEXT,
        result_json TEXT
      );
      
      CREATE TABLE IF NOT EXISTS state_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        snapshot_json TEXT
      );
    `);
  }

  // --- Beliefs ---
  upsertBelief(belief) {
    this._ensureInit();
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT INTO beliefs (key, current_value, confidence, history_json, superseded_json, last_verified)
      VALUES (@key, @currentValue, @confidence, @history, @superseded, @lastVerified)
      ON CONFLICT(key) DO UPDATE SET
        current_value = excluded.current_value,
        confidence = excluded.confidence,
        history_json = excluded.history_json,
        superseded_json = excluded.superseded_json,
        last_verified = excluded.last_verified
    `);

    stmt.run({
      key: belief.key,
      currentValue:
        typeof belief.currentValue === "string"
          ? belief.currentValue
          : JSON.stringify(belief.currentValue),
      confidence: belief.confidence,
      history: JSON.stringify(belief.history),
      superseded: JSON.stringify(belief.superseded),
      lastVerified: belief.lastVerified,
    });
  }

  // --- Journal Events ---
  insertJournalEvent(event) {
    this._ensureInit();
    if (!this.db) return;
    const stmt = this.db.prepare(`
      INSERT INTO journal_events (id, goal_id, timestamp, action_json, before_state_json, after_state_json, result_json)
      VALUES (@id, @goalId, @timestamp, @action, @beforeState, @afterState, @result)
    `);

    stmt.run({
      id: event.id,
      goalId: event.goalId,
      timestamp: event.timestamp,
      action: JSON.stringify(event.action),
      beforeState: JSON.stringify(event.beforeState),
      afterState: JSON.stringify(event.afterState),
      result: JSON.stringify(event.result),
    });
  }

  // --- Snapshots ---
  saveSnapshot(snapshotJson) {
    this._ensureInit();
    if (!this.db) return;
    const stmt = this.db.prepare(
      `INSERT INTO state_snapshots (timestamp, snapshot_json) VALUES (?, ?)`,
    );
    stmt.run(new Date().toISOString(), snapshotJson);
  }

  getLatestSnapshot() {
    this._ensureInit();
    if (!this.db) return null;
    const stmt = this.db.prepare(
      `SELECT * FROM state_snapshots ORDER BY id DESC LIMIT 1`,
    );
    return stmt.get();
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
        console.log(
          "[DatabaseManager] SQLite database connection closed cleanly.",
        );
      } catch (err) {
        console.warn(
          "[DatabaseManager] Failed to close SQLite database connection:",
          err.message,
        );
      }
      this.db = null;
      this._initialized = false;
    }
  }
}

const dbManager = new DatabaseManager();

// Register process teardown cleanups to release SQLite lock on reload/exit
process.on("exit", () => dbManager.close());
process.on("SIGINT", () => {
  dbManager.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  dbManager.close();
  process.exit(0);
});

module.exports = { DatabaseManager, dbManager };
