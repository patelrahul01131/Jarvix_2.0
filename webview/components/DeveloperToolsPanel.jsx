import { useMemo } from 'react';

export default function DeveloperToolsPanel({ session, messages }) {
  const devTools = session?.developerTools || [];

  const rawJsonPlans = useMemo(() => devTools.filter(d => d.type === 'plan'), [devTools]);
  const tokenUsages = useMemo(() => devTools.filter(d => d.type === 'tokenUsage'), [devTools]);

  return (
    <div className="developer-tools-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '12px' }}>
      
      {/* Token Usage Stats */}
      <div className="dev-card" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: '6px', background: 'var(--bg-elevated)', padding: '12px' }}>
        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#a78bfa' }}>
          <span>⚡</span> Token Metrics
        </div>
        {tokenUsages.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>No token data yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tokenUsages.slice(-5).reverse().map((t, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
                <span style={{ color: 'var(--fg-muted)' }}>{t.timestamp}</span>
                <span>{t.data.prompt_tokens} In / {t.data.completion_tokens} Out</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Raw Planner Output */}
      <div className="dev-card" style={{ border: '1px solid rgba(124, 106, 247, 0.2)', borderRadius: '6px', background: 'var(--bg-elevated)', padding: '12px' }}>
        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#a78bfa' }}>
          <span>🧠</span> Planner JSON Output
        </div>
        {rawJsonPlans.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>No plan data yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {rawJsonPlans.slice(-3).reverse().map((p, idx) => (
              <div key={idx} style={{ background: '#1e1e1e', padding: '8px', borderRadius: '4px', overflowX: 'auto' }}>
                <div style={{ fontSize: '10px', color: 'var(--fg-muted)', marginBottom: '4px' }}>{p.timestamp}</div>
                <pre style={{ margin: 0, fontSize: '10px', color: '#d4d4d4', fontFamily: 'var(--font-mono)' }}>
                  {JSON.stringify(p.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Errors */}
      <div className="dev-card" style={{ border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '6px', background: 'var(--bg-elevated)', padding: '12px' }}>
        <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: '#ef4444' }}>
          <span>❌</span> Agent Errors & Loops
        </div>
        {devTools.filter(d => d.type === 'error').length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--fg-muted)' }}>No errors recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {devTools.filter(d => d.type === 'error').slice(-5).reverse().map((e, idx) => (
              <div key={idx} style={{ fontSize: '11px', background: 'rgba(239, 68, 68, 0.1)', padding: '6px', borderRadius: '4px' }}>
                <div style={{ color: 'var(--fg-muted)', marginBottom: '2px', fontSize: '10px' }}>{e.timestamp}</div>
                <div style={{ color: '#fca5a5' }}>{e.data.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
