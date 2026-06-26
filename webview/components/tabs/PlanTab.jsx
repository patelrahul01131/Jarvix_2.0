import React from 'react';

export default function PlanTab({ plan }) {
  if (!plan) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-list-flat"></i>
        <div>No active plan</div>
      </div>
    );
  }

  return (
    <div className="plan-tab">
      <div className="plan-tab-header">
        <h3 className="plan-tab-title">{plan.goal || 'Execution Plan'}</h3>
      </div>
      
      <div className="plan-tab-body">
        <ol className="plan-steps">
          {(plan.steps || []).map((step, idx) => {
            let statusIcon = 'circle-outline';
            let statusClass = 'pending';
            
            if (step.status === 'completed') {
              statusIcon = 'pass-filled';
              statusClass = 'completed';
            } else if (step.status === 'active') {
              statusIcon = 'loading codicon-modifier-spin';
              statusClass = 'active';
            } else if (step.status === 'failed') {
              statusIcon = 'error';
              statusClass = 'failed';
            }

            return (
              <li key={idx} className={`plan-step ${statusClass}`}>
                <div className="plan-step-icon">
                  <i className={`codicon codicon-${statusIcon}`}></i>
                </div>
                <div className="plan-step-content">
                  <div className="plan-step-desc">{step.description || step}</div>
                  {step.details && <div className="plan-step-details">{step.details}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
