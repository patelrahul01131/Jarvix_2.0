import React from 'react';

export default function ObservationsTab({ observations }) {
  if (!observations || observations.length === 0) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-eye"></i>
        <div>No observations collected</div>
      </div>
    );
  }

  return (
    <div className="observations-tab">
      <div className="observations-list">
        {observations.map((obs) => {
          let icon = 'info';
          let color = 'var(--fg)';
          
          if (obs.type === 'error' || obs.type === 'linter') {
            icon = 'error';
            color = 'var(--danger)';
          } else if (obs.type === 'test') {
            icon = obs.passed ? 'pass' : 'error';
            color = obs.passed ? 'var(--success)' : 'var(--danger)';
          } else if (obs.type === 'browser') {
            icon = 'browser';
            color = 'var(--accent)';
          }

          return (
            <div key={obs.id} className="observation-item">
              <div className="observation-header">
                <i className={`codicon codicon-${icon}`} style={{ color }}></i>
                <span className="observation-type">{obs.type}</span>
                <span className="observation-source">{obs.source}</span>
              </div>
              <div className="observation-content">
                {obs.content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
