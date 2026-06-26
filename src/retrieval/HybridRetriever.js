/**
 * HybridRetriever — combines semantic + keyword + path + symbol search
 *
 * Pipeline:
 *   1. Semantic search (LanceDB vector similarity)          → top 50
 *   2. Keyword/BM25 search (grep-style, no external dep)   → top 30
 *   3. File path fuzzy match                               → top 20
 *   4. AST-based symbol extraction (@babel/parser)         → top 20
 *   ──────────────────────────────────────────────────────
 *   5. Merge & deduplicate                                 → up to 100 candidates
 *   6. Rerank by relevance score                           → top 20
 *   7. Context compression                                 → final context string
 *
 * Phase 5: Returns a status envelope:
 *   { status: "success|empty|failed|stale", results: [...], sources: [...], error_reason: null }
 */

const path = require('path');
const fs = require('fs');
const { semanticSearch, isIndexed, indexWorkspace, getTable } = require('../indexer/RepositoryIndexer.js');
const { embed } = require('../indexer/EmbeddingService.js');
const { listWorkspaceFiles, readFileFromWorkspace, getWorkspaceRoot } = require('../tools/fileSystem.js');
const { chunkFile } = require('../indexer/ChunkManager.js');

// ─── Language Registry ─────────────────────────────────────────────────────────
// Maps file extensions to their parser type.
// "babel"     → handled by @babel/parser (JS/JSX/TS/TSX)
// "plaintext" → no AST; falls back to keyword regex with a console.warn
const LANGUAGE_REGISTRY = {
  js:   'babel',
  jsx:  'babel',
  ts:   'babel',
  tsx:  'babel',
  mjs:  'babel',
  cjs:  'babel',
  py:   'plaintext',
  go:   'plaintext',
  rs:   'plaintext',
  java: 'plaintext',
  cpp:  'plaintext',
  c:    'plaintext',
  cs:   'plaintext',
  rb:   'plaintext',
  php:  'plaintext',
};

// ─── Lazy-load @babel/parser ──────────────────────────────────────────────────
let babelParser = null;
function getBabelParser() {
  if (babelParser) return babelParser;
  try {
    babelParser = require('@babel/parser');
    return babelParser;
  } catch (e) {
    console.warn('[HybridRetriever] @babel/parser not available — AST symbol extraction disabled.');
    return null;
  }
}

// ─── AST-based symbol extraction ─────────────────────────────────────────────
/**
 * Extract symbols from a JS/TS file using @babel/parser AST.
 * Returns array of { name, type, code, isExported, isTopLevel }
 */
function extractSymbolsFromAST(content, filePath) {
  const parser = getBabelParser();
  if (!parser) return [];

  let ast;
  try {
    ast = parser.parse(content, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: [
        'jsx',
        'typescript',
        'decorators-legacy',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'dynamicImport',
        'optionalChaining',
        'nullishCoalescingOperator',
        'objectRestSpread',
        'asyncGenerators',
      ],
    });
  } catch (e) {
    console.warn(`[HybridRetriever] AST parse failed for ${filePath}:`, e.message);
    return [];
  }

  const symbols = [];
  const lines = content.split('\n');

  function getCodeSlice(node) {
    try {
      return content.slice(node.start, Math.min(node.end, node.start + 4000));
    } catch {
      return '';
    }
  }

  function getNodeName(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'StringLiteral') return node.value;
    return null;
  }

  function processNode(node, isExported = false, isTopLevel = true) {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression': {
        const name = getNodeName(node.id);
        if (name) symbols.push({ name, type: 'function', code: getCodeSlice(node), isExported, isTopLevel });
        break;
      }

      case 'ClassDeclaration':
      case 'ClassExpression': {
        const name = getNodeName(node.id);
        if (name) {
          symbols.push({ name, type: 'class', code: getCodeSlice(node), isExported, isTopLevel });
          // Extract class methods
          if (node.body && node.body.body) {
            for (const member of node.body.body) {
              if (member.type === 'ClassMethod' || member.type === 'ClassPrivateMethod') {
                const methodName = getNodeName(member.key);
                if (methodName) {
                  const isPrivate = member.type === 'ClassPrivateMethod' || member.accessibility === 'private';
                  symbols.push({ name: `${name}.${methodName}`, type: 'method', code: getCodeSlice(member), isExported: false, isTopLevel: false, isPrivate });
                }
              }
            }
          }
        }
        break;
      }

      case 'VariableDeclaration': {
        for (const declarator of (node.declarations || [])) {
          const name = getNodeName(declarator.id);
          if (!name) continue;
          const init = declarator.init;
          if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
            symbols.push({ name, type: 'arrow_function', code: getCodeSlice(node), isExported, isTopLevel });
          } else if (init && (init.type === 'ClassExpression')) {
            symbols.push({ name, type: 'class', code: getCodeSlice(node), isExported, isTopLevel });
          } else {
            symbols.push({ name, type: 'variable', code: getCodeSlice(node), isExported, isTopLevel });
          }
        }
        break;
      }

      case 'TSInterfaceDeclaration': {
        const name = getNodeName(node.id);
        if (name) symbols.push({ name, type: 'interface', code: getCodeSlice(node), isExported, isTopLevel });
        break;
      }

      case 'TSTypeAliasDeclaration': {
        const name = getNodeName(node.id);
        if (name) symbols.push({ name, type: 'type', code: getCodeSlice(node), isExported, isTopLevel });
        break;
      }

      case 'TSEnumDeclaration': {
        const name = getNodeName(node.id);
        if (name) symbols.push({ name, type: 'enum', code: getCodeSlice(node), isExported, isTopLevel });
        break;
      }

      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration': {
        if (node.declaration) {
          processNode(node.declaration, true, true);
        }
        break;
      }

      case 'ExpressionStatement': {
        // Handle module.exports = { ... } or module.exports.foo = function ...
        const expr = node.expression;
        if (expr?.type === 'AssignmentExpression') {
          const leftStr = content.slice(expr.left.start, expr.left.end);
          if (leftStr.startsWith('module.exports')) {
            if (expr.right?.type === 'ObjectExpression') {
              for (const prop of (expr.right.properties || [])) {
                const propName = getNodeName(prop.key);
                if (propName) symbols.push({ name: propName, type: 'export', code: getCodeSlice(prop.value || prop), isExported: true, isTopLevel: true });
              }
            }
          }
        }
        break;
      }
    }
  }

  // Walk top-level statements
  for (const node of (ast.program?.body || [])) {
    processNode(node, false, true);
  }

  return symbols;
}

// ─── Structural importance scoring ─────────────────────────────────────────────
/**
 * Apply importance modifiers to a symbol's base score.
 * +15 if exported or public
 * +10 if top-level class or interface
 * -5  if private or nested helper
 */
function applyImportanceScore(baseScore, symbol) {
  let score = baseScore;
  if (symbol.isExported) score += 15;
  if (symbol.isTopLevel && (symbol.type === 'class' || symbol.type === 'interface')) score += 10;
  if (symbol.isPrivate || (!symbol.isTopLevel && symbol.type === 'method')) score -= 5;
  return score;
}

// ─── Keyword search (BM25-style scoring without external deps) ────────────────
function keywordSearch(query, limit = 30) {
  const root = getWorkspaceRoot();
  if (!root) return [];

  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.jarvix', 'package-lock.json']);
  const terms = query
    .toLowerCase()
    .split(/[^a-zA-Z0-9_$]+/)
    .filter(t => t.length > 2);

  if (terms.length === 0) return [];

  const workspaceFiles = listWorkspaceFiles().filter(f => {
    if (f.type !== 'file') return false;
    const parts = f.path.replace(/\\/g, '/').split('/');
    return !parts.some(p => SKIP.has(p));
  });

  const results = [];

  for (const wf of workspaceFiles) {
    try {
      const content = fs.readFileSync(path.join(root, wf.path), 'utf8');
      const lower = content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let idx = 0;
        while ((idx = lower.indexOf(term, idx)) !== -1) {
          score++;
          idx += term.length;
        }
      }
      if (score > 0) {
        results.push({
          filePath: wf.path.replace(/\\/g, '/'),
          name: path.basename(wf.path),
          chunkType: 'file',
          code: content.slice(0, 4000),
          score,
          source: 'keyword',
        });
      }
    } catch {}
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─── File path fuzzy search ────────────────────────────────────────────────────
function filePathSearch(query, limit = 20) {
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.jarvix']);
  const terms = query.toLowerCase().split(/[^a-zA-Z0-9_]+/).filter(t => t.length > 2);

  const workspaceFiles = listWorkspaceFiles().filter(f => {
    if (f.type !== 'file') return false;
    const parts = f.path.replace(/\\/g, '/').split('/');
    return !parts.some(p => SKIP.has(p));
  });

  const results = [];

  for (const wf of workspaceFiles) {
    const normalPath = wf.path.toLowerCase().replace(/\\/g, '/');
    let score = 0;
    for (const term of terms) {
      if (normalPath.includes(term)) score += 2;
      if (path.basename(normalPath).includes(term)) score += 3;
    }
    if (score > 0) {
      results.push({
        filePath: wf.path.replace(/\\/g, '/'),
        name: path.basename(wf.path),
        chunkType: 'file',
        code: '',
        score,
        source: 'path',
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─── AST-based symbol search ──────────────────────────────────────────────────
/**
 * Search for symbols using AST (for babel-supported files) or
 * plaintext regex fallback for other supported languages.
 * Unsupported extensions are explicitly logged and skipped.
 */
function symbolSearch(query, limit = 20) {
  const root = getWorkspaceRoot();
  if (!root) return [];

  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.jarvix']);
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/[^a-zA-Z0-9_]+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) return [];

  const workspaceFiles = listWorkspaceFiles().filter(f => {
    if (f.type !== 'file') return false;
    const parts = f.path.replace(/\\/g, '/').split('/');
    return !parts.some(p => SKIP.has(p));
  });

  const results = [];

  for (const wf of workspaceFiles) {
    const ext = path.extname(wf.path).slice(1).toLowerCase();
    const parserType = LANGUAGE_REGISTRY[ext];

    if (parserType === undefined) {
      // Completely unknown extension — skip silently (binary files etc.)
      continue;
    }

    if (parserType === 'plaintext') {
      // Regex fallback for known-but-unsupported-AST languages
      console.warn(`[Jarvix] symbol search skipped: ${ext.toUpperCase()} not AST-supported, treating as plain text`);
      // Still do a simple keyword check to partially serve results
      try {
        const content = fs.readFileSync(path.join(root, wf.path), 'utf8');
        let score = 0;
        for (const term of queryTerms) {
          if (content.toLowerCase().includes(term)) score += 2;
        }
        if (score > 0) {
          results.push({
            filePath: wf.path.replace(/\\/g, '/'),
            name: path.basename(wf.path),
            chunkType: 'file',
            code: content.slice(0, 2000),
            score,
            source: 'symbol_plaintext',
          });
        }
      } catch {}
      continue;
    }

    // babel — use AST extraction
    if (parserType === 'babel') {
      try {
        const content = fs.readFileSync(path.join(root, wf.path), 'utf8');
        const symbols = extractSymbolsFromAST(content, wf.path);

        for (const sym of symbols) {
          const nameLower = sym.name.toLowerCase();
          let baseScore = 0;
          for (const term of queryTerms) {
            if (nameLower === term) baseScore += 10;
            else if (nameLower.includes(term)) baseScore += 5;
            else if (term.includes(nameLower) && nameLower.length > 3) baseScore += 3;
          }

          if (baseScore > 0) {
            const finalScore = applyImportanceScore(baseScore, sym);
            results.push({
              filePath: wf.path.replace(/\\/g, '/'),
              name: sym.name,
              chunkType: sym.type,
              code: sym.code || '',
              score: finalScore,
              source: 'symbol_ast',
            });
          }
        }
      } catch (e) {
        console.warn(`[HybridRetriever] AST symbol search failed for ${wf.path}:`, e.message);
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─── Deduplicate by filePath ───────────────────────────────────────────────────
function deduplicateByFile(results) {
  const seen = new Map();
  for (const r of results) {
    const key = r.filePath;
    if (!seen.has(key) || (seen.get(key).score || 0) < (r.score || 0)) {
      seen.set(key, r);
    }
  }
  return [...seen.values()];
}

// ─── Reranker ─────────────────────────────────────────────────────────────────
function rerank(results, query) {
  const queryTerms = query.toLowerCase().split(/[^a-zA-Z0-9_]+/).filter(t => t.length > 2);

  return results.map(r => {
    let finalScore = r.score || 0;

    if (r.source === 'semantic')        finalScore += 20;
    if (r.source === 'symbol_ast')      finalScore += 17; // AST results rank higher than regex
    if (r.source === 'symbol_plaintext') finalScore += 12;
    if (r.source === 'keyword')         finalScore += 10;
    if (r.source === 'path')            finalScore += 5;

    const normalPath = (r.filePath || '').toLowerCase();
    for (const term of queryTerms) {
      if (normalPath.includes(term)) finalScore += 3;
    }

    const codeText = (r.code || '').toLowerCase();
    let codeMatches = 0;
    for (const term of queryTerms) {
      if (codeText.includes(term)) codeMatches++;
    }
    finalScore += codeMatches * 2;

    return { ...r, finalScore };
  }).sort((a, b) => b.finalScore - a.finalScore);
}

// ─── Context compression ──────────────────────────────────────────────────────
function compressContext(ranked, maxChars = 40_000) {
  const root = getWorkspaceRoot();
  let context = '';
  let usedChars = 0;
  const loadedFiles = new Map();

  for (const r of ranked) {
    if (usedChars >= maxChars) break;

    let code = r.code || '';
    if (r.filePath && root && !loadedFiles.has(r.filePath)) {
      try {
        const full = fs.readFileSync(path.join(root, r.filePath), 'utf8');
        loadedFiles.set(r.filePath, full.split('\n'));
      } catch {
        loadedFiles.set(r.filePath, []);
      }
    }

    if (!code && r.filePath && loadedFiles.has(r.filePath)) {
      const lines = loadedFiles.get(r.filePath);
      if (lines.length > 0) {
        // Extract window if line numbers are known
        if (r.startLine && r.endLine) {
          const start = Math.max(0, r.startLine - 5);
          const end = Math.min(lines.length, r.endLine + 5);
          code = lines.slice(start, end).join('\n');
        } else {
          // fallback to front of file
          code = lines.slice(0, 150).join('\n');
        }
      }
    }

    if (!code || !code.trim()) continue;

    const block = `\n--- ${r.filePath} (${r.chunkType}: ${r.name}) ---\n${code}\n`;
    if (usedChars + block.length > maxChars) {
      const remaining = maxChars - usedChars;
      if (remaining > 200) {
        context += block.slice(0, remaining) + '\n// [truncated]\n';
      }
      break;
    }
    context += block;
    usedChars += block.length;
  }

  return context;
}

// ─── Phase 5: Index staleness check ──────────────────────────────────────────
/**
 * Check if the index is stale (older than the most recently modified workspace file).
 * @returns {Promise<boolean>}
 */
async function isIndexStale() {
  try {
    const root = getWorkspaceRoot();
    if (!root) return false;

    // Get the index meta file mtime
    const metaPath = path.join(root, '.jarvix', 'index_meta.json');
    if (!fs.existsSync(metaPath)) return true; // No meta = definitely stale

    const indexMtime = fs.statSync(metaPath).mtimeMs;

    // Check if any workspace file is newer than the index
    const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.jarvix', 'package-lock.json']);
    const files = listWorkspaceFiles().filter(f => {
      if (f.type !== 'file') return false;
      const parts = f.path.replace(/\\/g, '/').split('/');
      return !parts.some(p => SKIP.has(p));
    });

    for (const wf of files) {
      try {
        const stat = fs.statSync(path.join(root, wf.path));
        if (stat.mtimeMs > indexMtime) return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Main hybrid retrieval function ───────────────────────────────────────────
/**
 * Retrieve the most relevant code chunks for a given query.
 *
 * Returns a status envelope:
 * { status: "success"|"empty"|"failed"|"stale", results: Object[], sources: string[], context: string, count: number, error_reason: string|null }
 */
async function retrieve(query, options = {}) {
  const { topK = 20, maxChars = 40_000, useSemantic = true } = options;

  let allResults = [];
  let retrievalStatus = 'success';
  let errorReason = null;

  // ── Phase 5: Index readiness and staleness checks ──────────────────────────
  if (useSemantic) {
    try {
      const indexed = await isIndexed();
      if (!indexed) {
        retrievalStatus = 'stale';
        errorReason = 'Index does not exist or is empty';
        // Trigger background re-index (non-blocking)
        setImmediate(async () => {
          try {
            console.log('[HybridRetriever] Index missing — triggering background re-index...');
            await indexWorkspace();
            console.log('[HybridRetriever] Background re-index complete.');
          } catch (e) {
            console.warn('[HybridRetriever] Background re-index failed:', e.message);
          }
        });
      } else {
        const stale = await isIndexStale();
        if (stale) {
          retrievalStatus = 'stale';
          errorReason = 'Index is older than recently modified workspace files';
          setImmediate(async () => {
            try {
              console.log('[HybridRetriever] Stale index — triggering background re-index...');
              await indexWorkspace();
              console.log('[HybridRetriever] Background re-index complete.');
            } catch (e) {
              console.warn('[HybridRetriever] Background re-index failed:', e.message);
            }
          });
        }
      }
    } catch (e) {
      console.warn('[HybridRetriever] Readiness check failed:', e.message);
      retrievalStatus = 'stale';
      errorReason = e.message;
    }
  }

  // 1. Semantic search (even if stale — may still have useful results)
  if (useSemantic) {
    try {
      const semanticResponse = await semanticSearch(query, { limit: 50 });
      const mapped = semanticResponse.results.map(r => ({
        filePath: r.filePath,
        name: r.name || '',
        chunkType: r.chunkType || 'file',
        code: r.code || '',
        score: r._distance ? (1 - r._distance) * 100 : 50,
        source: 'semantic',
      }));
      allResults = allResults.concat(mapped);
      if (mapped.length > 0 && retrievalStatus === 'stale') {
        // Still got results — degrade to stale but don't fail
      }
    } catch (err) {
      console.warn('[HybridRetriever] Semantic search failed:', err.message);
      if (retrievalStatus === 'success') {
        retrievalStatus = 'failed';
        errorReason = err.message;
      }
    }
  }

  // 2. Keyword search
  const kwResults = keywordSearch(query, 30);
  allResults = allResults.concat(kwResults);

  // 3. File path search
  const pathResults = filePathSearch(query, 20);
  allResults = allResults.concat(pathResults);

  // 4. AST symbol search
  const symbolResults = symbolSearch(query, 20);
  allResults = allResults.concat(symbolResults);

  // 5. Deduplicate
  const deduped = deduplicateByFile(allResults);

  // 6. Rerank
  const ranked = rerank(deduped, query).slice(0, topK);

  // 7. Compress context
  const context = compressContext(ranked, maxChars);
  const sources = ranked.map(r => r.filePath).filter(Boolean);

  // Determine final status
  if (retrievalStatus === 'success' && ranked.length === 0) {
    retrievalStatus = 'empty';
  }

  console.log('[HybridRetriever] Final status:', {
    status: retrievalStatus,
    results: ranked,
    context,
    sources,
    count: ranked.length,
    error_reason: errorReason,
  });

  return {
    status: retrievalStatus,
    results: ranked,
    context,
    sources,
    count: ranked.length,
    error_reason: errorReason,
  };
}

module.exports = {
  retrieve,
  keywordSearch,
  filePathSearch,
  symbolSearch,
  rerank,
  compressContext,
  extractSymbolsFromAST,
  isIndexStale,
};
