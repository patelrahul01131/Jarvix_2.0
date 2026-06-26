import React from 'react';

export default function BeliefsTab({ beliefs }) {
  if (!beliefs) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-lightbulb"></i>
        <div>No beliefs formed</div>
      </div>
    );
  }

  return (
    <div className="json-tab">
      <pre>{JSON.stringify(beliefs, null, 2)}</pre>
    </div>
  );
}
