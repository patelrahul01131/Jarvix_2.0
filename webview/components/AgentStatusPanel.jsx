import { useEffect, useRef } from 'react';

export default function AgentStatusPanel({ statusHistory, isLoading }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [statusHistory]);

  if (!isLoading && (!statusHistory || statusHistory.length === 0)) return null;

  return (
    <div className="agent-status-panel" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: 'var(--radius-md)', background: 'rgba(124, 106, 247, 0.04)', padding: '12px' }}>
      <div className="agent-status-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        {isLoading && <span className="activity-spinner" style={{ width: '10px', height: '10px', border: '2px solid rgba(124,106,247,0.3)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
        <span>Agent Activity</span>
      </div>
      <div 
        className="agent-pipeline" 
        ref={containerRef}
        style={{ maxHeight: '180px', overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        {statusHistory.map((status, idx) => {
          const isLatest = idx === statusHistory.length - 1;
          const isActive = isLoading && isLatest;
          
          let badge = '';
          let text = status;
          const match = status.match(/^\[([A-Z_]+)\]\s*(.*)$/);
          if (match) {
            badge = match[1];
            text = match[2];
          }

          let icon = '⚙️';
          if (badge === 'READING' || status.toLowerCase().includes('reading')) icon = '📂';
          else if (badge === 'EDITING' || status.toLowerCase().includes('editing')) icon = '✍️';
          else if (badge === 'SCANNING' || status.toLowerCase().includes('scanning')) icon = '🔍';
          else if (badge === 'EXECUTING' || status.toLowerCase().includes('executing')) icon = '📟';
          else if (badge === 'LISTING' || status.toLowerCase().includes('listing')) icon = '📁';
          else if (status.toLowerCase().includes('thinking')) icon = '🧠';

          return (
            <div
              key={idx}
              className={`pipeline-step ${isActive ? 'active' : 'done'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', background: isActive ? 'var(--accent-dim)' : 'transparent', padding: '4px 8px', borderRadius: '4px' }}
            >
              <span className="pipeline-icon" style={{ fontSize: '13px' }}>{icon}</span>
              <span className="pipeline-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                {badge && (
                   <span style={{ 
                     fontSize: '9px', 
                     fontWeight: '700', 
                     background: 'rgba(124,106,247,0.2)', 
                     color: '#a78bfa', 
                     padding: '2px 6px', 
                     borderRadius: '4px',
                     flexShrink: 0
                   }}>
                     {badge}
                   </span>
                )}
                <span style={{ 
                  color: isActive ? 'var(--fg)' : 'var(--fg-muted)',
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {text}
                </span>
              </span>
              <span className="pipeline-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? 'var(--accent)' : 'var(--success)' }} />
            </div>
          );
        })}
        {!isLoading && statusHistory.length > 0 && (
          <div className="pipeline-step done" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px' }}>
            <span className="pipeline-icon">✅</span>
            <span className="pipeline-label" style={{ color: 'var(--success)', fontSize: '11px', fontWeight: 'bold' }}>Completed</span>
          </div>
        )}
      </div>
    </div>
  );
}
