import { useState } from 'react';

export default function CommandPermissionViewer({ cmd, onAccept, onDecline }) {
  const { command, status } = cmd;
  const [showCommand, setShowCommand] = useState(false);

  // Heuristic for risk
  const isHighRisk = /(rm\s|del\s|format|curl|wget|\.sh|\.bat|sudo|chmod|chown)/i.test(command);
  const risk = isHighRisk ? "High" : "Low";
  const riskColor = isHighRisk ? "#f85149" : "#6ee7b7";

  return (
    <div style={{
      border: '1px solid rgba(124, 106, 247, 0.3)',
      borderRadius: '8px',
      margin: '12px 0',
      background: 'var(--bg-elevated)',
      overflow: 'hidden',
      fontFamily: 'var(--vscode-font-family, sans-serif)',
      fontSize: '13px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: 'var(--accent)', marginBottom: '8px' }}>
          <span>💻</span>
          <span>Jarvix wants to run a command</span>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', color: 'var(--fg)' }}>
           <div style={{ display: 'flex', gap: '8px' }}>
             <span style={{ color: 'var(--fg-muted)', width: '60px' }}>Action:</span>
             <span>Execute terminal command</span>
           </div>
           <div style={{ display: 'flex', gap: '8px' }}>
             <span style={{ color: 'var(--fg-muted)', width: '60px' }}>Risk:</span>
             <span style={{ color: riskColor, fontWeight: 'bold' }}>{risk}</span>
           </div>
        </div>
      </div>
      
      {showCommand && (
        <div style={{
          padding: '12px 16px',
          background: '#1e1e1e',
          fontFamily: 'var(--vscode-editor-font-family, Consolas, monospace)',
          fontSize: '12px',
          color: '#d4d4d4',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          borderBottom: '1px solid rgba(255,255,255,0.05)'
        }}>
          {command}
        </div>
      )}

      <div style={{
        padding: '10px 16px',
        background: 'rgba(0,0,0,0.2)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <button 
          onClick={() => setShowCommand(!showCommand)}
          style={{ background: 'transparent', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: '12px', padding: 0 }}
        >
          {showCommand ? 'Hide Command' : 'View Command'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {status === 'pending' && (
            <>
              <button
                onClick={onDecline}
                style={{
                  background: 'transparent',
                  color: 'var(--fg)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '4px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Reject
              </button>
              <button
                onClick={onAccept}
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Approve
              </button>
            </>
          )}
          {status === 'accepted' && (
            <span style={{ color: 'var(--success)', fontSize: '12px', fontWeight: 'bold' }}>✓ Approved</span>
          )}
          {status === 'declined' && (
            <span style={{ color: '#f85149', fontSize: '12px', fontWeight: 'bold' }}>✗ Rejected</span>
          )}
        </div>
      </div>
    </div>
  );
}
