/**
 * ChunkManager — code-aware file chunker
 *
 * Splits source files into semantically meaningful chunks:
 *   - Function-level chunks
 *   - Class-level chunks
 *   - Top-level import blocks
 *   - File-level fallback (for small files or unknown languages)
 *
 * Avoids fixed-size arbitrary splits.
 */

const path = require('path');

/**
 * @typedef {Object} CodeChunk
 * @property {string} id            - Unique chunk ID: `filePath::chunkName`
 * @property {string} filePath      - Relative path in workspace
 * @property {string} chunkType     - 'function' | 'class' | 'imports' | 'file'
 * @property {string} name          - Symbol name (function/class name) or file basename
 * @property {string} language      - Detected language
 * @property {string} code          - The actual source code of this chunk
 * @property {number} startLine     - 1-indexed start line
 * @property {number} endLine       - 1-indexed end line
 * @property {string[]} imports     - Import/require paths found in this chunk
 * @property {string[]} exports     - Exported names found in this chunk
 */

// ─── Language detection ────────────────────────────────────────────────────────
function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const map = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    css: 'css', scss: 'css', less: 'css',
    html: 'html', htm: 'html',
    json: 'json',
    md: 'markdown', mdx: 'markdown',
    yaml: 'yaml', yml: 'yaml',
    sh: 'shell', bash: 'shell',
    c: 'c', cpp: 'c', h: 'c', hpp: 'c',
    prisma: 'prisma',
    graphql: 'graphql', gql: 'graphql',
  };
  return map[ext] || 'text';
}

// ─── Extract imports from code ─────────────────────────────────────────────────
function extractImports(code, language) {
  const imports = new Set();

  if (['javascript', 'typescript'].includes(language)) {
    // require('...')
    const reqRegex = /require\s*\(\s*['"`]([^'"`\n]+)['"`]\s*\)/g;
    let m;
    while ((m = reqRegex.exec(code)) !== null) imports.add(m[1]);
    // import ... from '...'
    const impRegex = /import\s+(?:[\w\s{},*]+\s+from\s+)?['"`]([^'"`\n]+)['"`]/g;
    while ((m = impRegex.exec(code)) !== null) imports.add(m[1]);
  } else if (language === 'python') {
    const pyRegex = /(?:import|from)\s+([\w.]+)/g;
    let m;
    while ((m = pyRegex.exec(code)) !== null) imports.add(m[1]);
  }

  return [...imports];
}

// ─── Extract exports from code ─────────────────────────────────────────────────
function extractExports(code, language) {
  const exports_ = new Set();

  if (['javascript', 'typescript'].includes(language)) {
    // module.exports = { ... }
    const meRegex = /module\.exports\s*=\s*\{([^}]+)\}/g;
    let m;
    while ((m = meRegex.exec(code)) !== null) {
      const names = m[1].match(/\b(\w+)\b/g) || [];
      names.forEach(n => exports_.add(n));
    }
    // export function / export class / export const
    const expRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|async function)\s+(\w+)/g;
    while ((m = expRegex.exec(code)) !== null) exports_.add(m[1]);
    // module.exports = functionName
    const meSimple = /module\.exports\s*=\s*(\w+)/g;
    while ((m = meSimple.exec(code)) !== null) exports_.add(m[1]);
  }

  return [...exports_];
}

// ─── Split JS/TS code into function/class chunks ──────────────────────────────
function chunkJavaScript(code, filePath, language) {
  const chunks = [];
  try {
    const parser = require('@babel/parser');
    const traverse = require('@babel/traverse').default;

    const ast = parser.parse(code, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx", "decorators-legacy"]
    });

    const lines = code.split('\n');

    // 1. Gather top-level imports
    let importEndLine = 0;
    traverse(ast, {
      ImportDeclaration(path) {
        importEndLine = Math.max(importEndLine, path.node.loc.end.line);
      },
      CallExpression(path) {
        if (path.node.callee.name === 'require' && path.scope.parent === null) {
          importEndLine = Math.max(importEndLine, path.node.loc.end.line);
        }
      }
    });

    if (importEndLine > 0) {
      const importCode = lines.slice(0, importEndLine).join('\n');
      chunks.push({
        id: `${filePath}::imports`,
        filePath,
        chunkType: 'imports',
        name: 'imports',
        language,
        code: importCode,
        startLine: 1,
        endLine: importEndLine,
        imports: extractImports(importCode, language),
        exports: [],
      });
    }

    // 2. Extract Functions and Classes
    traverse(ast, {
      FunctionDeclaration(path) {
        if (!path.node.id) return;
        const start = path.node.loc.start.line;
        const end = path.node.loc.end.line;
        const chunkCode = lines.slice(start - 1, end).join('\n');
        
        let skeleton = chunkCode;
        if (path.node.body?.loc) {
          skeleton = lines.slice(start - 1, path.node.body.loc.start.line).join('\n') + ' ... }';
        }

        chunks.push({
          id: `${filePath}::${path.node.id.name}`,
          filePath,
          chunkType: 'function',
          name: path.node.id.name,
          language,
          code: chunkCode,
          skeleton,
          startLine: start,
          endLine: end,
          imports: extractImports(chunkCode, language),
          exports: extractExports(chunkCode, language),
        });
      },
      ClassDeclaration(path) {
        if (!path.node.id) return;
        const start = path.node.loc.start.line;
        const end = path.node.loc.end.line;
        const chunkCode = lines.slice(start - 1, end).join('\n');

        let skeleton = chunkCode;
        if (path.node.body?.loc) {
          skeleton = lines.slice(start - 1, path.node.body.loc.start.line).join('\n') + ' ... }';
        }

        chunks.push({
          id: `${filePath}::${path.node.id.name}`,
          filePath,
          chunkType: 'class',
          name: path.node.id.name,
          language,
          code: chunkCode,
          skeleton,
          startLine: start,
          endLine: end,
          imports: extractImports(chunkCode, language),
          exports: extractExports(chunkCode, language),
        });
      },
      VariableDeclarator(path) {
        if ((path.node.init?.type === 'ArrowFunctionExpression' || path.node.init?.type === 'FunctionExpression') && path.node.id?.name) {
          const start = path.parent.loc.start.line;
          const end = path.parent.loc.end.line;
          const chunkCode = lines.slice(start - 1, end).join('\n');

          let skeleton = chunkCode;
          if (path.node.init?.body?.loc) {
            skeleton = lines.slice(start - 1, path.node.init.body.loc.start.line).join('\n') + ' ... }';
          }

          chunks.push({
            id: `${filePath}::${path.node.id.name}`,
            filePath,
            chunkType: 'function',
            name: path.node.id.name,
            language,
            code: chunkCode,
            skeleton,
            startLine: start,
            endLine: end,
            imports: extractImports(chunkCode, language),
            exports: extractExports(chunkCode, language),
          });
        }
      }
    });

  } catch (err) {
    console.warn(`[ChunkManager] AST parsing failed for ${filePath}. Falling back to line-based chunking.`, err.message);
    return chunkByLines(code, filePath, language);
  }

  return chunks;
}

// ─── Split Python code into function/class chunks ─────────────────────────────
function chunkPython(code, filePath) {
  const lines = code.split('\n');
  const chunks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const defMatch = line.match(/^(def|class)\s+(\w+)/);

    if (!defMatch) { i++; continue; }

    const type = defMatch[1] === 'class' ? 'class' : 'function';
    const name = defMatch[2];
    const baseIndent = line.match(/^\s*/)[0].length;
    const start = i;
    i++;

    // Collect all lines that are indented deeper than the def line
    while (i < lines.length) {
      const nextLine = lines[i];
      if (nextLine.trim() === '') { i++; continue; }
      const indent = nextLine.match(/^\s*/)[0].length;
      if (indent <= baseIndent && nextLine.trim() !== '') break;
      i++;
    }

    const chunkCode = lines.slice(start, i).join('\n');
    chunks.push({
      id: `${filePath}::${name}`,
      filePath,
      chunkType: type,
      name,
      language: 'python',
      code: chunkCode,
      startLine: start + 1,
      endLine: i,
      imports: extractImports(chunkCode, 'python'),
      exports: [],
    });
  }

  return chunks;
}

// ─── File-level fallback: split into 60-line overlapping windows ──────────────
function chunkByLines(code, filePath, language, windowSize = 60, overlap = 15) {
  const lines = code.split('\n');
  if (lines.length <= windowSize) {
    return [{
      id: `${filePath}::file`,
      filePath,
      chunkType: 'file',
      name: path.basename(filePath),
      language,
      code,
      startLine: 1,
      endLine: lines.length,
      imports: extractImports(code, language),
      exports: extractExports(code, language),
    }];
  }

  const chunks = [];
  let start = 0;
  let chunkIdx = 0;

  while (start < lines.length) {
    const end = Math.min(start + windowSize, lines.length);
    const chunkCode = lines.slice(start, end).join('\n');
    chunks.push({
      id: `${filePath}::chunk_${chunkIdx}`,
      filePath,
      chunkType: 'file',
      name: `${path.basename(filePath)}#${chunkIdx}`,
      language,
      code: chunkCode,
      startLine: start + 1,
      endLine: end,
      imports: chunkIdx === 0 ? extractImports(chunkCode, language) : [],
      exports: chunkIdx === 0 ? extractExports(chunkCode, language) : [],
    });
    start += windowSize - overlap;
    chunkIdx++;
  }

  return chunks;
}

// ─── Main chunking entry point ────────────────────────────────────────────────
/**
 * Split a file's content into semantically meaningful chunks.
 * @param {string} filePath - Relative workspace path
 * @param {string} code     - File content
 * @returns {CodeChunk[]}
 */
function chunkFile(filePath, code) {
  if (!code || !code.trim()) return [];

  const language = detectLanguage(filePath);

  // Skip binary / non-text files (rough check)
  if (/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|mp3|zip|tar|gz|lock)$/i.test(filePath)) {
    return [];
  }

  // Skip very large files (>500KB)
  if (code.length > 500_000) {
    return chunkByLines(code, filePath, language, 80, 20);
  }

  let chunks = [];

  if (['javascript', 'typescript'].includes(language)) {
    chunks = chunkJavaScript(code, filePath, language);
  } else if (language === 'python') {
    chunks = chunkPython(code, filePath);
  } else {
    // For all other languages, use line-window chunking
    chunks = chunkByLines(code, filePath, language);
  }

  // If no structured chunks found, fall back to file-level chunk
  if (chunks.length === 0) {
    chunks = chunkByLines(code, filePath, language);
  }

  return chunks;
}

module.exports = { chunkFile, detectLanguage, extractImports, extractExports };
