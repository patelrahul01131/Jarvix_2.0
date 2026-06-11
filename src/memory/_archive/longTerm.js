'use strict';

/**
 * MemoryStore — LanceDB-backed long-term memory for Jarvix.
 *
 * Stores permanent "facts" extracted during episodic summarization.
 * Examples: "User prefers arrow functions", "Project uses MongoDB"
 *
 * Separate from the code-index table (jarvix_code_index) to avoid
 * contaminating retrieval results with non-code content.
 */

const path = require('path');
const fs = require('fs');
const { embed, EMBEDDING_DIM } = require('../indexer/EmbeddingService.js');
const { getWorkspaceRoot } = require('../tools/fileSystem.js');

const MEMORY_TABLE = 'jarvix_memories';

// Module-level singletons
let lancedb = null;
let db = null;
let memoryTable = null;

// ─── Connect to the same LanceDB database as the code index ──────────────────
async function connectDB() {
  if (db) return db;
  try {
    if (!lancedb) {
      lancedb = await import('@lancedb/lancedb');
    }
    const root = getWorkspaceRoot();
    if (!root) throw new Error('No workspace open');
    const dbPath = path.join(root, '.jarvix', 'lancedb');
    // Ensure directory exists
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }
    db = await lancedb.connect(dbPath);
    return db;
  } catch (err) {
    console.error('[MemoryStore] LanceDB connect failed:', err.message);
    throw err;
  }
}

// ─── Get or create the memories table ────────────────────────────────────────
async function getMemoryTable() {
  if (memoryTable) return memoryTable;
  const database = await connectDB();

  try {
    const tableNames = await database.tableNames();
    if (tableNames.includes(MEMORY_TABLE)) {
      memoryTable = await database.openTable(MEMORY_TABLE);
    } else {
      // Bootstrap with a dummy row to establish schema, then delete it
      const dummy = [{
        id: '__init__',
        fact: '',
        context: '',
        sessionId: '',
        timestamp: 0,
        vector: new Array(EMBEDDING_DIM).fill(0),
      }];
      memoryTable = await database.createTable(MEMORY_TABLE, dummy);
      await memoryTable.delete('id = "__init__"');
      console.log('[MemoryStore] Created jarvix_memories table.');
    }
    return memoryTable;
  } catch (err) {
    console.error('[MemoryStore] Table setup failed:', err.message);
    throw err;
  }
}

// ─── Reset the singleton (needed when workspace changes) ─────────────────────
function resetMemoryStore() {
  db = null;
  memoryTable = null;
}

/**
 * Store a permanent fact in the memory table.
 * @param {string} fact      - The fact to remember (e.g. "User prefers arrow functions")
 * @param {string} context   - Where this fact came from (e.g. session summary)
 * @param {string} sessionId - The session that produced this fact
 */
async function storeFact(fact, context = '', sessionId = '') {
  if (!fact || typeof fact !== 'string' || fact.trim().length < 5) return;
  try {
    const tbl = await getMemoryTable();
    const vector = await embed(fact);
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await tbl.add([{
      id,
      fact: fact.trim().slice(0, 2000),
      context: context.trim().slice(0, 1000),
      sessionId,
      timestamp: Date.now(),
      vector,
    }]);
  } catch (err) {
    console.warn('[MemoryStore] storeFact failed:', err.message);
  }
}

/**
 * Store multiple facts in a batch.
 * @param {string[]} facts
 * @param {string}   context
 * @param {string}   sessionId
 */
async function storeFacts(facts, context = '', sessionId = '') {
  if (!Array.isArray(facts)) return;
  for (const fact of facts) {
    await storeFact(fact, context, sessionId);
  }
}

/**
 * Query the memory table for facts relevant to a question.
 * @param {string} question
 * @param {number} [topK=5]
 * @returns {Promise<string[]>}  - Array of relevant fact strings
 */
async function queryMemories(question, topK = 5) {
  if (!question || typeof question !== 'string') return [];
  try {
    const tbl = await getMemoryTable();
    const queryVector = await embed(question);

    // Check if table has any rows first
    const count = await tbl.countRows();
    if (count === 0) return [];

    const results = await tbl
      .vectorSearch(queryVector)
      .limit(topK)
      .toArray();

    return results
      .filter(r => r.fact && r.fact.trim().length > 0)
      .map(r => r.fact);
  } catch (err) {
    console.warn('[MemoryStore] queryMemories failed:', err.message);
    return [];
  }
}

/**
 * Get total count of stored memories.
 * @returns {Promise<number>}
 */
async function getMemoryCount() {
  try {
    const tbl = await getMemoryTable();
    return await tbl.countRows();
  } catch {
    return 0;
  }
}

module.exports = {
  storeFact,
  storeFacts,
  queryMemories,
  getMemoryCount,
  resetMemoryStore,
};
