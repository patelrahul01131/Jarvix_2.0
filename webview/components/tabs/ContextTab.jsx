import React from 'react';

export default function ContextTab({ contextData }) {
  if (!contextData) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-symbol-misc"></i>
        <div>No context collected</div>
      </div>
    );
  }

  return (
    <div className="json-tab">
      <pre>{JSON.stringify(contextData, null, 2)}</pre>
    </div>
  );
}
