import { useMemo } from 'react';

function getFileIcon(filename) {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';
  const map = {
    js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
    css: '🎨', json: '📋', md: '📝', html: '🌐',
    py: '🐍', sh: '⚙️', env: '🔑', sql: '🗄️',
  };
  return map[ext] || '📄';
}

export default function ContextPanel({ session, messages, isLoading }) {
  const taskMemory = session?.taskMemory || {};
  const workingMemory = session?.workingMemory || {};
  
  // Derive current goal from memory
  const currentGoal = taskMemory.goal || null;
  
  const currentStep = taskMemory.current_step || 'Initializing...';
  const activeFiles = Array.isArray(workingMemory.activeFiles) ? workingMemory.activeFiles : [];
  
  // Calculate completed edits from messages
  const completedSteps = useMemo(() => {
    return messages.reduce((acc, m) => acc + (m.fileEdits?.filter(e => e.status === 'accepted')?.length || 0), 0);
  }, [messages]);

  const pendingFileEdits = useMemo(() => {
    return messages.reduce((acc, m) => acc + (m.fileEdits?.filter(e => e.status === 'pending')?.length || 0), 0);
  }, [messages]);

  const loopCount = useMemo(() => {
    if (!session?.developerTools) return 0;
    // Count how many plans in a row have been generated without an intermediate user message
    let count = 0;
    for (let i = session.developerTools.length - 1; i >= 0; i--) {
      if (session.developerTools[i].type === 'plan') count++;
      else break;
    }
    return count;
  }, [session?.developerTools]);

  return (
    <div className="context-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '12px' }}>

      {/* Current Goal */}
      <div className="context-card" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: '6px', padding: '10px', background: 'var(--bg-elevated)' }}>
        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
          <span>🎯</span> Current Goal
        </div>
        <div style={{ fontSize: '12px', color: currentGoal ? 'var(--fg)' : 'var(--fg-muted)' }}>
          {currentGoal || "No active goal"}
        </div>
      </div>

      {/* Agent Status */}
      {isLoading && (
        <div className="context-card" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: '6px', padding: '10px', background: 'var(--bg-elevated)' }}>
          <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
            <span>⚡</span> Current Step
          </div>
          <div style={{ fontSize: '12px', color: 'var(--accent)' }}>
            {currentStep}
          </div>
          {loopCount > 2 && (
            <div style={{ fontSize: '10px', color: 'var(--warning)', marginTop: '4px' }}>
              Loop Check: {loopCount} consecutive plans
            </div>
          )}
        </div>
      )}

      {/* Active Files */}
      {activeFiles.length > 0 && (
        <div className="context-card" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: '6px', padding: '10px', background: 'var(--bg-elevated)' }}>
          <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
            <span>📂</span> Active Files
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {activeFiles.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                <span>{getFileIcon(f)}</span>
                <span>{typeof f === 'string' ? f.split(/[/\\]/).pop() : JSON.stringify(f)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress */}
      {(completedSteps > 0 || pendingFileEdits > 0) && (
        <div className="context-card" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: '6px', padding: '10px', background: 'var(--bg-elevated)' }}>
          <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', fontSize: '12px' }}>
            <span>📊</span> File Changes
          </div>
          <div style={{ fontSize: '11px', color: 'var(--fg-muted)', marginBottom: '6px' }}>
            <span>{completedSteps} file{completedSteps !== 1 ? 's' : ''} modified</span>
            {pendingFileEdits > 0 && (
              <span style={{ color: 'var(--warning)', marginLeft: '8px' }}>{pendingFileEdits} pending review</span>
            )}
          </div>
          <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{ 
                height: '100%', 
                background: pendingFileEdits > 0 ? 'var(--warning)' : 'var(--success)',
                width: pendingFileEdits > 0 ? `${(completedSteps / Math.max(1, completedSteps + pendingFileEdits)) * 100}%` : '100%',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
        </div>
      )}
      
      {!currentGoal && !isLoading && (
        <div style={{ textAlign: 'center', padding: '16px 0', fontSize: '12px', color: 'var(--fg-muted)' }}>
          Start a conversation to see context
        </div>
      )}
    </div>
  );
}
