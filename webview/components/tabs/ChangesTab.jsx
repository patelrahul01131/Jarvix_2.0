import React, { useState } from 'react';

export default function ChangesTab({ changes }) {
  const [selectedFile, setSelectedFile] = useState(null);

  if (!changes || changes.length === 0) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-git-commit"></i>
        <div>No changes in this session</div>
      </div>
    );
  }

  const renderFileTree = () => {
    return (
      <div className="changes-file-tree">
        {changes.map((file, idx) => (
          <div 
            key={idx} 
            className={`tree-item ${selectedFile === file.path ? 'selected' : ''}`}
            onClick={() => setSelectedFile(file.path)}
          >
            <i className={`codicon codicon-${file.status === 'added' ? 'diff-added' : file.status === 'removed' ? 'diff-removed' : 'diff-modified'}`}></i>
            <span className="tree-item-name">{file.name}</span>
            <span className="tree-item-dir">{file.dir}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderDiff = () => {
    const file = changes.find(f => f.path === selectedFile);
    if (!file) return <div className="diff-placeholder">Select a file to view changes</div>;

    return (
      <div className="diff-view">
        <div className="diff-header">
          <span className="diff-file-path">{file.path}</span>
          <button className="revert-btn" title="Revert Changes">
            <i className="codicon codicon-discard"></i>
          </button>
        </div>
        <div className="diff-content">
          {(file.hunks || []).map((hunk, idx) => (
            <div key={idx} className="diff-hunk">
              <div className="hunk-header">{hunk.header}</div>
              {hunk.lines.map((line, lidx) => (
                <div key={lidx} className={`diff-line ${line.type}`}>
                  <span className="line-num">{line.oldNum || ''}</span>
                  <span className="line-num">{line.newNum || ''}</span>
                  <span className="line-text">{line.content}</span>
                </div>
              ))}
            </div>
          ))}
          {(!file.hunks || file.hunks.length === 0) && (
            <div className="diff-placeholder">Diff content not available</div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="changes-tab">
      <div className="changes-sidebar">
        {renderFileTree()}
      </div>
      <div className="changes-main">
        {renderDiff()}
      </div>
    </div>
  );
}
