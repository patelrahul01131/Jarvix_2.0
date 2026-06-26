import React from 'react';

export default function WorldStateTab({ worldState }) {
  if (!worldState) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-globe"></i>
        <div>No world state loaded</div>
      </div>
    );
  }

  return (
    <div className="json-tab">
      <pre>{JSON.stringify(worldState, null, 2)}</pre>
    </div>
  );
}
