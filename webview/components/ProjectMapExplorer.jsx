import { useState, useMemo } from 'react';

function getFileIcon(filename) {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  const map = {
    js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
    css: '🎨', json: '📋', md: '📝', html: '🌐',
    py: '🐍', sh: '⚙️', env: '🔑', sql: '🗄️',
    png: '🖼️', jpg: '🖼️', svg: '🖼️', gif: '🖼️',
    lock: '🔒', gitignore: '🚫',
  };
  return map[ext] || '📄';
}

/** Build a nested tree from flat file list */
function buildTree(files) {
  const root = {};
  for (const f of files) {
    if (!f.path) continue;
    const parts = f.path.replace(/\\/g, '/').split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = { __isDir: true, __children: {} };
      node = node[parts[i]].__children;
    }
    const fname = parts[parts.length - 1];
    node[fname] = { __isDir: false, __path: f.path };
  }
  return root;
}

function TreeNode({ name, node, depth = 0, filter, highlightedFile, onHighlight }) {
  const [open, setOpen] = useState(depth < 2);
  const isDir = node?.__isDir;

  // Filter check
  const lowerFilter = filter.toLowerCase();
  if (!isDir && lowerFilter && !name.toLowerCase().includes(lowerFilter)) return null;

  const indent = depth * 14;
  const isHighlighted = !isDir && node?.__path === highlightedFile;

  if (isDir) {
    const children = node.__children || {};
    const childKeys = Object.keys(children).sort((a, b) => {
      // dirs first
      const aDir = children[a]?.__isDir;
      const bDir = children[b]?.__isDir;
      if (aDir && !bDir) return -1;
      if (!aDir && bDir) return 1;
      return a.localeCompare(b);
    });

    // If filter active, check if any children match
    if (lowerFilter) {
      const hasMatch = childKeys.some(k =>
        !children[k].__isDir && k.toLowerCase().includes(lowerFilter)
      );
      if (!hasMatch) return null;
    }

    return (
      <div>
        <div
          className="tree-node dir"
          style={{ paddingLeft: `${indent + 4}px` }}
          onClick={() => setOpen(o => !o)}
        >
          <span className="tree-icon">{open ? '📂' : '📁'}</span>
          <span className="tree-name">{name}</span>
        </div>
        {open && childKeys.map(k => (
          <TreeNode
            key={k}
            name={k}
            node={children[k]}
            depth={depth + 1}
            filter={filter}
            highlightedFile={highlightedFile}
            onHighlight={onHighlight}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-node file ${isHighlighted ? 'highlighted' : ''}`}
      style={{ paddingLeft: `${indent + 4}px` }}
      onClick={() => onHighlight(node.__path)}
      title={node.__path}
    >
      <span className="tree-icon">{getFileIcon(name)}</span>
      <span className="tree-name">{name}</span>
    </div>
  );
}

export default function ProjectMapExplorer({ workspaceFiles }) {
  const [filter, setFilter] = useState('');
  const [highlightedFile, setHighlightedFile] = useState(null);

  const files = useMemo(() =>
    (workspaceFiles || []).filter(f => f.type === 'file'),
    [workspaceFiles]
  );

  const tree = useMemo(() => buildTree(files), [files]);

  const rootKeys = Object.keys(tree).sort((a, b) => {
    const aDir = tree[a]?.__isDir;
    const bDir = tree[b]?.__isDir;
    if (aDir && !bDir) return -1;
    if (!aDir && bDir) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="project-map">
      <div className="project-search">
        <span className="project-search-icon">🔍</span>
        <input
          type="text"
          placeholder="Search files…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {filter && (
          <span
            style={{ fontSize: '11px', color: 'var(--fg-muted)', cursor: 'pointer' }}
            onClick={() => setFilter('')}
          >✕</span>
        )}
      </div>

      {files.length === 0 ? (
        <div className="project-map-empty">No workspace files loaded</div>
      ) : (
        <div className="file-tree">
          {rootKeys.map(k => (
            <TreeNode
              key={k}
              name={k}
              node={tree[k]}
              depth={0}
              filter={filter}
              highlightedFile={highlightedFile}
              onHighlight={setHighlightedFile}
            />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div style={{ fontSize: '10px', color: 'var(--fg-muted)', paddingTop: '4px', borderTop: '1px solid var(--border)' }}>
          {files.length} file{files.length !== 1 ? 's' : ''}
          {highlightedFile && (
            <span style={{ marginLeft: '8px', color: 'var(--accent-2)' }}>
              · {highlightedFile.split('/').pop() || highlightedFile.split('\\').pop()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
