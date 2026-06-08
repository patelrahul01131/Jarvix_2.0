import { useState } from 'react';

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onClearAll,
  onDeleteSession,
  onRenameSession
}) {
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState('');

  const sessionList = Object.values(sessions).sort(
    (a, b) => b.createdAt - a.createdAt
  );

  const startRename = (e, session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title || 'Untitled');
  };

  const saveRename = (id) => {
    if (editTitle.trim()) onRenameSession(id, editTitle.trim());
    setEditingId(null);
  };

  function formatTime(ts) {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  return (
    <div className="sidebar">
      {/* Branding */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">⚡</div>
        <span className="sidebar-brand-name">Jarvix</span>
      </div>

      <button className="new-session-btn" onClick={onNewSession}>
        <span>＋</span> New Session
      </button>

      <div className="sidebar-header">Sessions</div>

      <div className="sessions-list">
        {sessionList.length === 0 && (
          <div style={{ padding: '12px 8px', fontSize: '11px', color: 'var(--fg-muted)', fontStyle: 'italic' }}>
            No sessions yet
          </div>
        )}

        {sessionList.map(session => {
          const msgCount = session.messages?.length || 0;
          return (
            <div
              key={session.id}
              className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => onSelectSession(session.id)}
              title={session.title}
            >
              {editingId === session.id ? (
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  onBlur={() => saveRename(session.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveRename(session.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  className="session-edit-input"
                />
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="session-title-text">
                      {session.title || 'Untitled'}
                    </div>
                    <div className="session-meta">
                      {msgCount > 0 && `${msgCount} msg${msgCount !== 1 ? 's' : ''} · `}
                      {formatTime(session.createdAt)}
                    </div>
                  </div>
                  <div className="session-item-actions">
                    <button
                      className="session-action-btn"
                      onClick={e => startRename(e, session)}
                      title="Rename"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button
                      className="session-action-btn"
                      onClick={e => { e.stopPropagation(); onDeleteSession(session.id); }}
                      title="Delete"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button className="clear-btn" onClick={onClearAll}>
          🗑 Clear all sessions
        </button>
      </div>
    </div>
  );
}