import { useMemo } from 'react';

export default function MemoryDashboard({ session, messages }) {
  const memory = session?.memory;

  // Short-term: last 3 user messages
  const shortTermMsgs = useMemo(() => {
    return messages
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => {
        const c = m.content;
        // Strip injected context prefix
        const reqMatch = c.match(/USER REQUEST:\s*(.+?)(?:\n|$)/i);
        const text = reqMatch ? reqMatch[1].trim() : c.slice(0, 60);
        return text.length > 60 ? text.slice(0, 60) + '…' : text;
      })
      .reverse();
  }, [messages]);

  // Working memory
  const modifiedFiles = memory?.modifiedFiles || [];
  const summarySent = memory?.summary || '';

  // Long-term: derive from session
  const sessionAge = session?.createdAt
    ? Math.floor((Date.now() - session.createdAt) / 60000)
    : 0;

  const totalMessages = messages.length;
  const assistantMessages = messages.filter(m => m.role === 'assistant').length;
  const filesCount = modifiedFiles.length;

  return (
    <div className="memory-dashboard">

      {/* Short-Term Memory */}
      <div className="memory-tier short-term">
        <div className="memory-tier-header">
          <span className="memory-tier-dot" />
          <span className="memory-tier-name">Short-Term Memory</span>
        </div>
        <div className="memory-tier-body">
          {shortTermMsgs.length === 0 ? (
            <div className="memory-empty">No recent messages</div>
          ) : (
            shortTermMsgs.map((msg, i) => (
              <div key={i} className="memory-field">
                <div className="memory-field-label">Message {shortTermMsgs.length - i}</div>
                <div className="memory-field-value" style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>
                  {msg}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Working Memory */}
      <div className="memory-tier working">
        <div className="memory-tier-header">
          <span className="memory-tier-dot" />
          <span className="memory-tier-name">Working Memory</span>
        </div>
        <div className="memory-tier-body">
          <div className="memory-field">
            <div className="memory-field-label">Session ID</div>
            <div className="memory-field-value" style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--fg-muted)' }}>
              {session?.id?.slice(0, 20) || '—'}…
            </div>
          </div>
          <div className="memory-field">
            <div className="memory-field-label">Active Files</div>
            {modifiedFiles.length === 0 ? (
              <div className="memory-field-value" style={{ color: 'var(--fg-muted)' }}>None yet</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: '2px' }}>
                {modifiedFiles.slice(-6).map((f, i) => (
                  <span key={i} className="memory-tag">
                    📄 {f.split('/').pop() || f.split('\\').pop()}
                  </span>
                ))}
                {modifiedFiles.length > 6 && (
                  <span className="memory-tag">+{modifiedFiles.length - 6} more</span>
                )}
              </div>
            )}
          </div>
          {summarySent && (
            <div className="memory-field">
              <div className="memory-field-label">Context Summary</div>
              <div className="memory-field-value" style={{ fontSize: '10px', color: 'var(--fg-muted)' }}>
                {summarySent.slice(0, 120)}{summarySent.length > 120 ? '…' : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Long-Term Memory */}
      <div className="memory-tier long-term">
        <div className="memory-tier-header">
          <span className="memory-tier-dot" />
          <span className="memory-tier-name">Long-Term Memory</span>
        </div>
        <div className="memory-tier-body">
          <div className="memory-field">
            <div className="memory-field-label">Session Age</div>
            <div className="memory-field-value">
              {sessionAge < 60
                ? `${sessionAge} min`
                : `${Math.floor(sessionAge / 60)}h ${sessionAge % 60}m`}
            </div>
          </div>
          <div className="memory-field">
            <div className="memory-field-label">Exchange Count</div>
            <div className="memory-field-value">{assistantMessages} responses ({totalMessages} total)</div>
          </div>
          <div className="memory-field">
            <div className="memory-field-label">Files Modified</div>
            <div className="memory-field-value">
              {filesCount === 0
                ? <span style={{ color: 'var(--fg-muted)' }}>None</span>
                : <span style={{ color: 'var(--success)', fontWeight: 600 }}>{filesCount} file{filesCount !== 1 ? 's' : ''}</span>
              }
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
