// src/agent-core/infrastructure/Repositories.js
const path = require("path");
const fs = require("fs");
const { Transaction, Workflow, ExecutionStep, Patch, Artifact, Permission, Snapshot, Worker, Capability, ExecutionResult } = require("../domain/Models");

class SQLiteConnection {
  constructor(dbPath) {
    this.dbPath = dbPath || this._getDbPath();
    this.db = null;
    this.init();
  }

  _getDbPath() {
    let root = process.env.JARVIX_WORKSPACE_ROOT || process.cwd();
    try {
      const { getWorkspaceRoot } = require("../../tools/fileSystem");
      const wsRoot = getWorkspaceRoot();
      if (wsRoot) root = wsRoot;
    } catch (e) {
      // Fallback
    }
    const dir = path.join(root, ".jarvix");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, "v7_runtime.sqlite");
  }

  init() {
    try {
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath, { verbose: null });
      this.db.pragma("journal_mode = WAL");
      this._createTables();
    } catch (err) {
      console.error("[SQLiteConnection] Failed to load better-sqlite3:", err.message);
      // In-memory fallback wrapper if sqlite fails to load (ABI mismatch fallback)
      this.db = this._createMemoryFallback();
    }
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        state TEXT,
        created_time INTEGER,
        updated_time INTEGER,
        worker_id TEXT,
        permission_scopes TEXT,
        resource_cost REAL,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS workflows (
        transaction_id TEXT PRIMARY KEY,
        nodes TEXT,
        edges TEXT,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        transaction_id TEXT,
        type TEXT,
        path TEXT,
        content TEXT,
        format TEXT,
        sequence INTEGER,
        metadata TEXT
      );

      CREATE TABLE IF NOT EXISTS event_log (
        global_sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_sequence_id INTEGER,
        transaction_id TEXT,
        event_name TEXT,
        schema_version INTEGER,
        migration_strategy TEXT,
        payload TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS permissions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT,
        scope TEXT,
        status TEXT,
        requested_time INTEGER,
        decided_time INTEGER,
        reason TEXT
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        workspace_hash TEXT,
        git_head TEXT,
        diagnostics_version TEXT,
        timestamp INTEGER
      );
    `);
  }

  _createMemoryFallback() {
    console.warn("[SQLiteConnection] Using in-memory repository fallback.");
    const store = {
      transactions: {},
      workflows: {},
      artifacts: {},
      event_log: [],
      permissions: {},
      snapshots: {}
    };
    return {
      exec: () => {},
      prepare: (sql) => {
        // Very basic mock of better-sqlite3 features
        return {
          run: (...args) => {
            // Mocks can be implemented dynamically in the repository wrappers if needed
            return { changes: 1 };
          },
          get: (...args) => null,
          all: (...args) => []
        };
      },
      store
    };
  }
}

class TransactionRepository {
  constructor(sqliteConnection) {
    this.conn = sqliteConnection;
  }

  save(tx) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare(`
        INSERT INTO transactions (id, state, created_time, updated_time, worker_id, permission_scopes, resource_cost, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          updated_time = excluded.updated_time,
          worker_id = excluded.worker_id,
          permission_scopes = excluded.permission_scopes,
          resource_cost = excluded.resource_cost,
          metadata = excluded.metadata
      `);
      stmt.run(
        tx.id,
        tx.state,
        tx.createdTime,
        tx.updatedTime,
        tx.workerId,
        JSON.stringify(tx.permissionScopes),
        tx.resourceCost,
        JSON.stringify(tx.metadata)
      );
    } else {
      this.conn.db.store.transactions[tx.id] = tx;
    }
  }

  get(id) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare("SELECT * FROM transactions WHERE id = ?");
      const row = stmt.get(id);
      if (!row) return null;
      return new Transaction({
        id: row.id,
        state: row.state,
        createdTime: row.created_time,
        updatedTime: row.updated_time,
        workerId: row.worker_id,
        permissionScopes: JSON.parse(row.permission_scopes),
        resourceCost: row.resource_cost,
        metadata: JSON.parse(row.metadata)
      });
    } else {
      return this.conn.db.store.transactions[id] || null;
    }
  }
}

class ArtifactRepository {
  constructor(sqliteConnection) {
    this.conn = sqliteConnection;
  }

  save(art) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare(`
        INSERT OR REPLACE INTO artifacts (id, transaction_id, type, path, content, format, sequence, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        art.id,
        art.transactionId,
        art.type,
        art.path,
        art.content,
        art.format,
        art.sequence,
        JSON.stringify(art.metadata)
      );
    } else {
      this.conn.db.store.artifacts[art.id] = art;
    }
  }

  get(id) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare("SELECT * FROM artifacts WHERE id = ?");
      const row = stmt.get(id);
      if (!row) return null;
      return new Artifact({
        id: row.id,
        transactionId: row.transaction_id,
        type: row.type,
        path: row.path,
        content: row.content,
        format: row.format,
        sequence: row.sequence,
        metadata: JSON.parse(row.metadata)
      });
    } else {
      return this.conn.db.store.artifacts[id] || null;
    }
  }

  getByTransaction(txId) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare("SELECT * FROM artifacts WHERE transaction_id = ? ORDER BY sequence ASC");
      const rows = stmt.all(txId);
      return rows.map(row => new Artifact({
        id: row.id,
        transactionId: row.transaction_id,
        type: row.type,
        path: row.path,
        content: row.content,
        format: row.format,
        sequence: row.sequence,
        metadata: JSON.parse(row.metadata)
      }));
    } else {
      return Object.values(this.conn.db.store.artifacts).filter(a => a.transactionId === txId);
    }
  }
}

class EventRepository {
  constructor(sqliteConnection) {
    this.conn = sqliteConnection;
  }

  append(event) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare(`
        INSERT INTO event_log (transaction_sequence_id, transaction_id, event_name, schema_version, migration_strategy, payload, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const info = stmt.run(
        event.transactionSequenceId,
        event.transactionId,
        event.eventName,
        event.schemaVersion,
        event.migrationStrategy || null,
        JSON.stringify(event.payload),
        event.timestamp || Date.now()
      );
      return info.lastInsertRowid;
    } else {
      const globalId = this.conn.db.store.event_log.length + 1;
      const storedEvent = {
        globalSequenceId: globalId,
        ...event,
        timestamp: event.timestamp || Date.now()
      };
      this.conn.db.store.event_log.push(storedEvent);
      return globalId;
    }
  }

  getEventsAfter(globalSequenceId) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare("SELECT * FROM event_log WHERE global_sequence_id > ? ORDER BY global_sequence_id ASC");
      const rows = stmt.all(globalSequenceId);
      return rows.map(r => ({
        globalSequenceId: r.global_sequence_id,
        transactionSequenceId: r.transaction_sequence_id,
        transactionId: r.transaction_id,
        eventName: r.event_name,
        schemaVersion: r.schema_version,
        migrationStrategy: r.migration_strategy,
        payload: JSON.parse(r.payload),
        timestamp: r.timestamp
      }));
    } else {
      return this.conn.db.store.event_log.filter(e => e.globalSequenceId > globalSequenceId);
    }
  }
}

class PermissionRepository {
  constructor(sqliteConnection) {
    this.conn = sqliteConnection;
  }

  save(perm) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare(`
        INSERT INTO permissions (id, transaction_id, scope, status, requested_time, decided_time, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          decided_time = excluded.decided_time,
          reason = excluded.reason
      `);
      stmt.run(
        perm.id,
        perm.transactionId,
        perm.scope,
        perm.status,
        perm.requestedTime,
        perm.decidedTime,
        perm.reason
      );
    } else {
      this.conn.db.store.permissions[perm.id] = perm;
    }
  }

  get(id) {
    if (!this.conn.db.store) {
      const stmt = this.conn.db.prepare("SELECT * FROM permissions WHERE id = ?");
      const row = stmt.get(id);
      if (!row) return null;
      return new Permission({
        id: row.id,
        transactionId: row.transaction_id,
        scope: row.scope,
        status: row.status,
        requestedTime: row.requested_time,
        decidedTime: row.decided_time,
        reason: row.reason
      });
    } else {
      return this.conn.db.store.permissions[id] || null;
    }
  }
}

module.exports = {
  SQLiteConnection,
  TransactionRepository,
  ArtifactRepository,
  EventRepository,
  PermissionRepository
};
