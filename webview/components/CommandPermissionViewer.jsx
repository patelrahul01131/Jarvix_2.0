export default function CommandPermissionViewer({ cmd, onAccept, onDecline }) {
  const { command, status } = cmd;

  return (
    <div style={{
      border: '1px solid var(--vscode-widget-border, #444)',
      borderRadius: '6px',
      margin: '12px 0',
      background: 'var(--vscode-sideBar-background, #252526)',
      overflow: 'hidden',
      fontFamily: 'var(--vscode-font-family, sans-serif)',
      fontSize: '13px'
    }}>
      <div style={{
        padding: '8px 12px',
        background: 'rgba(0, 122, 204, 0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid var(--vscode-widget-border, #444)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: '#007acc' }}>
          <span>💻</span>
          <span>Suggested Command</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {status === 'pending' && (
            <>
              <button
                onClick={onAccept}
                style={{
                  background: '#2ea44f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Run Command
              </button>
              <button
                onClick={onDecline}
                style={{
                  background: '#f85149',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Decline
              </button>
            </>
          )}
          {status === 'accepted' && (
            <span style={{ color: '#2ea44f', fontSize: '12px', fontWeight: 'bold' }}>✓ Executed</span>
          )}
          {status === 'declined' && (
            <span style={{ color: '#f85149', fontSize: '12px', fontWeight: 'bold' }}>✗ Declined</span>
          )}
        </div>
      </div>
      
      <div style={{
        padding: '12px',
        background: 'var(--vscode-editor-background, #1e1e1e)',
        fontFamily: 'var(--vscode-editor-font-family, Consolas, monospace)',
        fontSize: '12px',
        color: 'var(--vscode-editor-foreground, #d4d4d4)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all'
      }}>
        {command}
      </div>
    </div>
  );
}
