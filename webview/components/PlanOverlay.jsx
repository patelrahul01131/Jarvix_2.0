import React from 'react';

export default function PlanOverlay({ plan, onApprove, onEdit, onReject }) {
  if (!plan) return null;

  return (
    <div className="plan-overlay-container">
      <div className="plan-overlay-card">
        <div className="plan-header">
          <div className="plan-title-wrapper">
            <i className="codicon codicon-list-flat plan-icon"></i>
            <h2 className="plan-title">{plan.goal || 'Execution Plan'}</h2>
          </div>
          <div className={`plan-risk risk-${(plan.risk || 'low').toLowerCase()}`}>
            Risk: {plan.risk || 'Low'}
          </div>
        </div>

        <div className="plan-stats">
          <div className="plan-stat">
            <span className="stat-value">{plan.files?.length || 0}</span>
            <span className="stat-label">Files</span>
          </div>
          <div className="plan-stat">
            <span className="stat-value">{plan.commands?.length || 0}</span>
            <span className="stat-label">Commands</span>
          </div>
          <div className="plan-stat">
            <span className="stat-value">{plan.steps?.length || 0}</span>
            <span className="stat-label">Steps</span>
          </div>
        </div>

        <div className="plan-content">
          <div className="plan-section">
            <h3>Steps</h3>
            <ol className="plan-steps-list">
              {(plan.steps || []).map((step, idx) => (
                <li key={idx}>{step.description || step}</li>
              ))}
              {(!plan.steps || plan.steps.length === 0) && (
                <li className="empty-text">No steps defined.</li>
              )}
            </ol>
          </div>
        </div>

        <div className="plan-actions">
          <button className="plan-btn reject" onClick={onReject}>
            <i className="codicon codicon-close"></i> Reject
          </button>
          <button className="plan-btn edit" onClick={onEdit}>
            <i className="codicon codicon-edit"></i> Edit Plan
          </button>
          <button className="plan-btn approve" onClick={onApprove}>
            <i className="codicon codicon-check"></i> Approve Plan
          </button>
        </div>
      </div>
    </div>
  );
}
