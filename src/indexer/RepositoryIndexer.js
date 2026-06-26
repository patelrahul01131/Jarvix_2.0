/**
 * RepositoryIndexer — LanceDB workspace indexer
 *
 * Scans the workspace, chunks all source files, generates embeddings,
 * and stores everything in LanceDB for fast semantic retrieval.
 *
 * Features:
 *   - Incremental indexing (only re-indexes changed files)
 *   - Metadata storage (path, type, name, language, line range, imports)
 *   - Persistent across extension restarts (LanceDB on disk)
 */

const path = require('path');
const fs = require('fs');
const { listWorkspaceFiles, readFileFromWorkspace, getWorkspaceRoot } = require('../tools/fileSystem.js');
const { chunkFile } = require('./ChunkManager.js');
const { embed, embedBatch, EMBEDDING_DIM } = require('./EmbeddingService.js');
const { DBHealthManager } = require('./DBHealthManager.js');

// LanceDB will be dynamically imported (ESM module)
let lancedb = null;
let db = null;
let table = null;

const TABLE_NAME = 'jarvix_code_index';
const INDEX_META_FILE = () => {
  const root = getWorkspaceRoot();
  return root ? path.join(root, '.jarvix', 'index_meta.json') : null;
};

// ─── Load index metadata (tracks file mtimes for incremental indexing) ─────────
function loadIndexMeta() {
  const metaPath = INDEX_META_FILE();
  if (!metaPath) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveIndexMeta(meta) {
  const metaPath = INDEX_META_FILE();
  if (!metaPath) return;
  const dir = path.dirname(metaPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

// ─── Connect to LanceDB ────────────────────────────────────────────────────────
async function connectDB() {
  if (db) return db;
  
  const root = getWorkspaceRoot();
  if (!root) throw new Error('No workspace open');
  const dbPath = path.join(root, '.jarvix', 'lancedb');

  const attemptConnect = async () => {
    if (!lancedb) {
      lancedb = await import('@lancedb/lancedb');
    }
    return await lancedb.connect(dbPath);
  };

  try {
    db = await attemptConnect();
    return db;
  } catch (err) {
    console.warn('[RepositoryIndexer] LanceDB connect failed, checking health...', err.message);
    const health = DBHealthManager.checkHealth();
    if (!health.healthy) {
      console.log(`[RepositoryIndexer] DB looks unhealthy (${health.reason}). Wiping and retrying...`);
      await DBHealthManager.wipeDB();
      try {
        db = await attemptConnect();
        return db;
      } catch (retryErr) {
        console.error('[RepositoryIndexer] LanceDB retry failed:', retryErr.message);
        throw retryErr;
      }
    }
    throw err;
  }
}

// ─── Get or create the LanceDB table ─────────────────────────────────────────
async function getTable() {
  if (table) return table;
  const database = await connectDB();

  try {
    const tableNames = await database.tableNames();
    if (tableNames.includes(TABLE_NAME)) {
      table = await database.openTable(TABLE_NAME);
    } else {
      // Create with a dummy row to establish schema, then delete it
      const dummy = [{
        id: '__init__',
        filePath: '',
        chunkType: 'file',
        name: '',
        language: '',
        code: '',
        skeleton: '',
        startLine: 0,
        endLine: 0,
        imports: '',
        exports: '',
        vector: new Array(EMBEDDING_DIM).fill(0),
      }];
      table = await database.createTable(TABLE_NAME, dummy);
      await table.delete('id = "__init__"');
    }
    return table;
  } catch (err) {
    console.error('[RepositoryIndexer] Table setup failed:', err.message);
    throw err;
  }
}

// ─── Index a single file ──────────────────────────────────────────────────────
async function indexFile(filePath, code) {
  const chunks = chunkFile(filePath, code);
  if (chunks.length === 0) return 0;

  const texts = chunks.map(c => `${c.chunkType} ${c.name} in ${c.filePath}\n${c.code}`);
  const vectors = await embedBatch(texts);

  const rows = chunks.map((chunk, i) => ({
    id: chunk.id,
    filePath: chunk.filePath,
    chunkType: chunk.chunkType,
    name: chunk.name,
    language: chunk.language,
    code: chunk.code,
    skeleton: chunk.skeleton || '',
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    imports: chunk.imports.join(','),
    exports: chunk.exports.join(','),
    vector: vectors[i],
  }));

  const tbl = await getTable();
  // Delete old rows for this file, then insert fresh
  try {
    await tbl.delete(`filePath = "${filePath.replace(/\\/g, '/')}"`);
  } catch {}
  await tbl.add(rows);
  return rows.length;
}

// ─── Remove a file from the index ────────────────────────────────────────────
async function removeFile(filePath) {
  try {
    const tbl = await getTable();
    await tbl.delete(`filePath = "${filePath.replace(/\\/g, '/')}"`);
  } catch (err) {
    console.warn('[RepositoryIndexer] Remove failed:', err.message);
  }
}

// ─── Full workspace index (incremental) ──────────────────────────────────────
/**
 * Index the entire workspace incrementally.
 * Only re-indexes files that have changed since last index.
 * @param {Function} [onProgress] - Called with (indexed, total, filePath)
 * @returns {Promise<{ indexed: number, skipped: number, removed: number, total: number }>}
 */
async function indexWorkspace(onProgress) {
  const root = getWorkspaceRoot();
  if (!root) return { indexed: 0, skipped: 0, removed: 0, total: 0 };

  const SKIP_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'woff', 'woff2', 'ttf', 'eot',
    'mp4', 'mp3', 'zip', 'tar', 'gz', 'lock', 'bin', 'exe', 'dll',
  ]);
  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage',
    '.cache', 'vendor', '__pycache__', '.jarvix',
  ]);

  const workspaceFiles = listWorkspaceFiles().filter(f => {
    if (f.type !== 'file') return false;
    const ext = path.extname(f.path).toLowerCase().slice(1);
    if (SKIP_EXTENSIONS.has(ext)) return false;
    const parts = f.path.replace(/\\/g, '/').split('/');
    return !parts.some(p => SKIP_DIRS.has(p));
  });

  const meta = loadIndexMeta();
  let indexed = 0;
  let skipped = 0;
  let removed = 0;
  const total = workspaceFiles.length;

  // Track existing files to detect deleted/moved ones
  const currentFiles = new Set(workspaceFiles.map(f => f.path.replace(/\\/g, '/')));

  for (const wf of workspaceFiles) {
    try {
      const fullPath = path.join(root, wf.path);
      const stat = fs.statSync(fullPath);
      const mtime = stat.mtimeMs;

      // Skip if file hasn't changed since last index
      if (meta[wf.path] && meta[wf.path] === mtime) {
        skipped++;
        if (onProgress) onProgress(indexed + skipped, total, wf.path, 'skipped');
        continue;
      }

      const content = await fs.promises.readFile(fullPath, 'utf8');
      const count = await indexFile(wf.path.replace(/\\/g, '/'), content);

      meta[wf.path] = mtime;
      indexed++;
      if (onProgress) onProgress(indexed + skipped, total, wf.path, 'indexed');
    } catch (err) {
      console.warn(`[RepositoryIndexer] Failed to index ${wf.path}:`, err.message);
      skipped++;
    }
  }

  // Detect and remove ghost index entries (files in meta but not in workspace)
  const metaKeys = Object.keys(meta);
  for (const key of metaKeys) {
    const normKey = key.replace(/\\/g, '/');
    if (!currentFiles.has(normKey)) {
      console.log(`[RepositoryIndexer] Removing deleted/ghost file from index: ${key}`);
      await removeFile(normKey);
      delete meta[key];
      removed++;
    }
  }

  saveIndexMeta(meta);
  return { indexed, skipped, removed, total };
}

// ─── Semantic vector search ────────────────────────────────────────────────────
/**
 * Search the index using vector similarity with observability and filtering.
 * @param {string} query - Natural language or code query
 * @param {Object} [options] - Filtering options
 * @param {string[]} [options.extensions] - e.g. ['.js', '.ts']
 * @param {string} [options.directory] - e.g. 'src/agent-core'
 * @param {number} [options.limit=20] - Maximum results to return
 * @returns {Promise<{ status: string, index_ready: boolean, warning: string, results: Object[] }>}
 */
async function semanticSearch(query, options = {}) {
  const limit = options.limit || 20;
  
  try {
    const isReady = await isIndexed();
    if (!isReady) {
      return { status: "empty", index_ready: false, warning: "Index is empty or missing. Please wait for the indexer to run.", results: [] };
    }

    const tbl = await getTable();
    const queryVector = await embed(query);
    let lancedbQuery = tbl.vectorSearch(queryVector);
    
    // Add simple string filtering if LanceDB supports it (falling back to post-filtering if not)
    // LanceDB node API supports simple SQL WHERE. Let's do post-filtering for safety across versions
    // Increase candidate pool significantly to avoid truncation blindspots due to early limits
    const candidateLimit = limit * 10;
    const rawResults = await lancedbQuery.limit(candidateLimit).toArray();
    
    // Reranking & Filtering logic
    const filteredResults = rawResults.filter(row => {
      if (options.extensions && options.extensions.length > 0) {
        const ext = path.extname(row.filePath).toLowerCase();
        if (!options.extensions.includes(ext)) return false;
      }
      if (options.directory) {
        // Support normalized paths
        const normPath = row.filePath.replace(/\\/g, '/');
        const normDir = options.directory.replace(/\\/g, '/');
        if (!normPath.startsWith(normDir)) return false;
      }
      return true;
    }).slice(0, limit);

    if (filteredResults.length === 0) {
      return { status: "empty", index_ready: true, warning: "No semantically relevant results found for the given filters.", results: [] };
    }

    return { status: "success", index_ready: true, warning: "", results: filteredResults };
  } catch (err) {
    console.warn('[RepositoryIndexer] Semantic search failed:', err.message);
    return { status: "failed", index_ready: false, warning: err.message, results: [] };
  }
}

/**
 * Check whether the index exists and has any data.
 * @returns {Promise<boolean>}
 */
async function isIndexed() {
  try {
    const tbl = await getTable();
    const count = await tbl.countRows();
    return count > 0;
  } catch {
    return false;
  }
}

module.exports = {
  indexWorkspace,
  indexFile,
  removeFile,
  semanticSearch,
  isIndexed,
  getTable,
};
