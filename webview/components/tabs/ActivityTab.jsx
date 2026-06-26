import React from 'react';

export default function ActivityTab({ activities }) {
  if (!activities || activities.length === 0) {
    return (
      <div className="tab-placeholder">
        <i className="codicon codicon-history"></i>
        <div>No activity recorded</div>
      </div>
    );
  }

  return (
    <div className="activity-tab">
      <div className="activity-timeline">
        {activities.map((act, idx) => (
          <div key={idx} className="activity-item">
            <div className="activity-time">{act.time}</div>
            <div className="activity-node">
              <div className="node-dot"></div>
              {idx < activities.length - 1 && <div className="node-line"></div>}
            </div>
            <div className="activity-content">
              <div className="activity-title">{act.title}</div>
              {act.description && <div className="activity-desc">{act.description}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
