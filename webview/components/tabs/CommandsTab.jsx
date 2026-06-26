import React, { useState } from 'react';

export default function CommandsTab({ commands }) {
  const [expandedId, setExpandedId] = useState(null);

  if (!commands || commands.length === 0) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-terminal"></i>
        <div>No commands executed</div>
      </div>
    );
  }

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div className="commands-tab">
      <div className="commands-list">
        {commands.map((cmd) => (
          <div key={cmd.id} className={`command-item ${expandedId === cmd.id ? 'expanded' : ''}`}>
            <div className="command-header" onClick={() => toggleExpand(cmd.id)}>
              <div className="command-status">
                {cmd.status === 'running' ? (
                  <i className="codicon codicon-loading codicon-modifier-spin" style={{ color: 'var(--accent)' }}></i>
                ) : cmd.exitCode === 0 ? (
                  <i className="codicon codicon-check" style={{ color: 'var(--success)' }}></i>
                ) : (
                  <i className="codicon codicon-error" style={{ color: 'var(--danger)' }}></i>
                )}
              </div>
              <div className="command-text">
                <span className="prompt">$</span> {cmd.command}
              </div>
              <div className="command-meta">
                {cmd.duration && <span>{cmd.duration}ms</span>}
                <i className={`codicon codicon-chevron-${expandedId === cmd.id ? 'down' : 'right'}`}></i>
              </div>
            </div>
            {expandedId === cmd.id && (
              <div className="command-output">
                {cmd.output || 'No output'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
