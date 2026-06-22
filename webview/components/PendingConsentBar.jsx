import { useState, useMemo } from 'react';
import { useStore } from '../store';

export default function PendingConsentBar() {
  const store = useStore();
  const [expanded, setExpanded] = useState(false);

  const activeSession = store.sessions[store.activeSessionId];
  const messages = activeSession?.messages || [];

  // Find all messages that have pending file edits
  const pendingEditsGroups = useMemo(() => {
    const groups = [];
    messages.forEach((msg, msgIndex) => {
      if (msg.fileEdits && msg.fileEdits.length > 0) {
        const pending = msg.fileEdits.filter(e => e.status === 'pending');
        if (pending.length > 0) {
          groups.push({
            messageIndex: msgIndex,
            edits: pending,
            allEdits: msg.fileEdits // To find the original edit index for setActiveWorkspaceView
          });
        }
      }
    });
    return groups;
  }, [messages]);

  const totalPending = pendingEditsGroups.reduce((acc, g) => acc + g.edits.length, 0);

  if (totalPending === 0) return null;

  return (
    <div className={`pending-consent-bar ${expanded ? 'expanded' : ''}`}>
      <div className="pending-consent-header" onClick={() => setExpanded(!expanded)}>
        <div className="pending-consent-title">
          <div className="pulse-dot warning"></div>
          <span>{totalPending} File Change{totalPending > 1 ? 's' : ''} Awaiting Consent</span>
        </div>
        <div className="pending-consent-actions">
           <button className="batch-btn accept" onClick={(e) => {
               e.stopPropagation();
               pendingEditsGroups.forEach(g => store.handleAcceptAllFiles(g.messageIndex));
               setExpanded(false);
           }}>Accept All</button>
           <button className="batch-btn decline" onClick={(e) => {
               e.stopPropagation();
               pendingEditsGroups.forEach(g => store.handleDeclineAllFiles(g.messageIndex));
               setExpanded(false);
           }}>Decline All</button>
           <span className="expand-icon">{expanded ? '▼' : '▲'}</span>
        </div>
      </div>
      {expanded && (
        <div className="pending-consent-body">
          {pendingEditsGroups.map((group, gIdx) => (
            <div key={gIdx} className="pending-consent-group">
              {group.edits.map((edit, eIdx) => {
                const originalIndex = group.allEdits.findIndex(e => e === edit);
                return (
                  <div 
                    key={eIdx} 
                    className="artifact-card diff compact"
                    onClick={() => store.setActiveWorkspaceView({ type: 'diff', messageIndex: group.messageIndex, fileIndex: originalIndex })}
                  >
                    <div className="artifact-icon">📄</div>
                    <div className="artifact-info">
                      <div className="artifact-title">{(edit.filePath || edit.path || '').split(/[/\\]/).pop() || '(unnamed)'}</div>
                    </div>
                    <div className="artifact-arrow">Review →</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
