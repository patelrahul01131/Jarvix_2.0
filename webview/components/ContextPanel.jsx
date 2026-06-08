import { useMemo } from 'react';

function extractActiveFiles(statusHistory) {
  const files = [];
  const seen = new Set();
  for (const s of statusHistory) {
    const m = s.match(/(?:Reading|Writing|Preparing|create)\s+([^\s.]+\.[a-zA-Z]{1,6})/i);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      files.push(m[1]);
    }
  }
  return files;
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    js: '🟨', jsx: '⚛️', ts: '🔷', tsx: '⚛️',
    css: '🎨', json: '📋', md: '📝', html: '🌐',
    py: '🐍', sh: '⚙️', env: '🔑', sql: '🗄️',
  };
  return map[ext] || '📄';
}

export default function ContextPanel({ statusHistory, messages, isLoading }) {
  const activeFiles = useMemo(() => extractActiveFiles(statusHistory), [statusHistory]);

  // Derive current goal from last user message
  const lastUserMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const c = messages[i].content;
        return c.length > 90 ? c.slice(0, 90) + '…' : c;
      }
    }
    return null;
  }, [messages]);

  // Derive current plan if any message has isPlan
  const latestPlan = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isPlan) return messages[i];
    }
    return null;
  }, [messages]);

  // Derive current task from statusHistory
  const currentTask = useMemo(() => {
    if (!statusHistory.length) return null;
    const last = statusHistory[statusHistory.length - 1];
    return last.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\s]+/u, '').trim();
  }, [statusHistory]);

  // Completed steps vs total
  const completedSteps = useMemo(() => {
    const fileEdits = messages.reduce((acc, m) => acc + (m.fileEdits?.length || 0), 0);
    return fileEdits;
  }, [messages]);

  const pendingFileEdits = useMemo(() => {
    return messages.reduce((acc, m) => {
      const pending = m.fileEdits?.filter(e => e.status === 'pending').length || 0;
      return acc + pending;
    }, 0);
  }, [messages]);

  return (
    <div className="context-panel">

      {/* Current Goal */}
      <div className="context-card">
        <div className="context-card-header">
          <span className="context-card-icon">🎯</span>
          Current Goal
        </div>
        <div className="context-card-body">
          {lastUserMsg
            ? <div className="context-goal-text">{lastUserMsg}</div>
            : <div className="context-empty">No active goal</div>
          }
        </div>
      </div>

      {/* Agent Status */}
      {isLoading && currentTask && (
        <div className="context-card">
          <div className="context-card-header">
            <span className="context-card-icon">⚡</span>
            Current Task
          </div>
          <div className="context-card-body">
            <div className="context-goal-text" style={{ color: 'var(--accent)' }}>
              {currentTask}
            </div>
          </div>
        </div>
      )}

      {/* Active Files */}
      {activeFiles.length > 0 && (
        <div className="context-card">
          <div className="context-card-header">
            <span className="context-card-icon">📂</span>
            Active Files
          </div>
          <div className="context-card-body">
            <div className="context-file-list">
              {activeFiles.map((f, i) => (
                <div key={i} className="context-file-item">
                  <span className="context-file-icon">{getFileIcon(f)}</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {completedSteps > 0 && (
        <div className="context-card">
          <div className="context-card-header">
            <span className="context-card-icon">📊</span>
            File Changes
          </div>
          <div className="context-card-body">
            <div className="progress-text">
              <span>{completedSteps} file{completedSteps !== 1 ? 's' : ''} modified</span>
              {pendingFileEdits > 0 && (
                <span style={{ color: 'var(--warning)' }}>{pendingFileEdits} pending</span>
              )}
            </div>
            <div className="progress-bar-container" style={{ marginTop: '8px' }}>
              <div
                className="progress-bar-fill"
                style={{ width: pendingFileEdits > 0 ? `${(completedSteps / (completedSteps + pendingFileEdits)) * 100}%` : '100%' }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Plan Summary */}
      {latestPlan && (
        <div className="context-card">
          <div className="context-card-header">
            <span className="context-card-icon">📋</span>
            Active Plan
          </div>
          <div className="context-card-body">
            <div style={{
              fontSize: '10px',
              color: latestPlan.planStatus === 'approved' ? 'var(--success)' : 'var(--warning)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              marginBottom: '4px'
            }}>
              {latestPlan.planStatus === 'approved' ? '✅ Approved' : '⏳ Awaiting Approval'}
            </div>
            <div className="context-empty" style={{ fontStyle: 'normal', fontSize: '11px' }}>
              {latestPlan.content.slice(0, 100)}…
            </div>
          </div>
        </div>
      )}

      {!lastUserMsg && !isLoading && (
        <div className="context-empty" style={{ textAlign: 'center', padding: '16px 0' }}>
          Start a conversation to see context
        </div>
      )}
    </div>
  );
}
