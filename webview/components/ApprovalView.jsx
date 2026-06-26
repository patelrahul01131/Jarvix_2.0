import React from 'react';

export default function ApprovalView({ approvalRequest, onApprove, onReject, onAlwaysAllow }) {
  if (!approvalRequest) return null;

  const { type, action, risk, files, reasoning } = approvalRequest;

  return (
    <div className="approval-view-container">
      <div className="approval-card">
        <div className="approval-header">
          <div className="approval-title-wrapper">
            <i className={`codicon codicon-${type === 'command' ? 'terminal' : 'file-code'} approval-icon`}></i>
            <h3 className="approval-title">Approval Required</h3>
          </div>
          <div className={`approval-risk risk-${(risk || 'low').toLowerCase()}`}>
            Risk: {risk || 'Low'}
          </div>
        </div>

        <div className="approval-body">
          <div className="approval-field">
            <span className="field-label">Action</span>
            <div className="field-value action-value">{action}</div>
          </div>
          
          {files && files.length > 0 && (
            <div className="approval-field">
              <span className="field-label">Affected Files</span>
              <ul className="field-list">
                {files.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          {reasoning && (
            <div className="approval-field">
              <span className="field-label">Reasoning</span>
              <div className="field-value reasoning-value">{reasoning}</div>
            </div>
          )}
        </div>

        <div className="approval-actions">
          <button className="approval-btn reject" onClick={onReject}>
            <i className="codicon codicon-close"></i> Reject
          </button>
          <button className="approval-btn allow-similar" onClick={onAlwaysAllow}>
            <i className="codicon codicon-shield"></i> Always Allow Similar
          </button>
          <button className="approval-btn approve" onClick={onApprove}>
            <i className="codicon codicon-check"></i> Approve
          </button>
        </div>
      </div>
    </div>
  );
}
