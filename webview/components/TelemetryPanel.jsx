export default function TelemetryPanel({ liveAgentState, session }) {
  if (!liveAgentState) {
    return (
      <div className="empty-state">
        <p>No active execution.</p>
        <p style={{ opacity: 0.6, fontSize: '0.85em' }}>
          Waiting for the state machine to engage...
        </p>
      </div>
    );
  }

  const { phase, currentStep, activeTool, executionStatus, totalSteps, budget, lastResult } = liveAgentState;

  // Derive some stats
  const budgetRatio = budget ? budget.toolCalls / budget.maxToolCalls : 0;
  const chunkFailures = session?.state?.chunkFailures || 0;

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* 1. Agent Status Bar */}
      <section>
        <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
          Agent Status Bar
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.9em' }}>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px', borderRadius: '4px' }}>
            <span style={{ opacity: 0.7, display: 'block', fontSize: '0.8em' }}>PHASE</span>
            <strong style={{ color: 'var(--accent)' }}>{phase || "IDLE"}</strong>
          </div>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px', borderRadius: '4px' }}>
            <span style={{ opacity: 0.7, display: 'block', fontSize: '0.8em' }}>EXECUTION</span>
            <strong>{executionStatus || "AWAITING"}</strong>
          </div>
          <div style={{ background: 'var(--bg-elevated)', padding: '8px', borderRadius: '4px', gridColumn: '1 / -1' }}>
            <span style={{ opacity: 0.7, display: 'block', fontSize: '0.8em' }}>BUDGET (Tokens / Tools)</span>
            <div style={{ marginTop: '4px', background: 'var(--bg-subtle)', borderRadius: '4px', overflow: 'hidden', height: '6px' }}>
              <div style={{ background: budgetRatio > 0.8 ? 'var(--error)' : 'var(--accent)', height: '100%', width: `${Math.min(budgetRatio * 100, 100)}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '0.8em' }}>
              <span>{budget?.toolCalls || 0} / {budget?.maxToolCalls || 0} tools</span>
              <span>{budget?.tokensUsed || 0} / {budget?.maxTokens || 0} tkns</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. DAG Progress Tracker */}
      <section>
        <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
          DAG Progress Tracker
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9em' }}>
          {session?.taskMemory?.completed?.map((task, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', color: 'var(--success)' }}>
              <span>✅</span> <span>{task}</span>
            </div>
          ))}
          {session?.taskMemory?.active?.map((task, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', color: 'var(--accent)', fontWeight: 'bold' }}>
              <span>▶️</span> <span>{task}</span>
            </div>
          ))}
          {session?.taskMemory?.pending?.map((task, i) => (
            <div key={i} style={{ display: 'flex', gap: '8px', opacity: 0.5 }}>
              <span>⏸️</span> <span>{task}</span>
            </div>
          ))}
          {(!session?.taskMemory?.completed?.length && !session?.taskMemory?.active?.length && !session?.taskMemory?.pending?.length) && (
            <div style={{ opacity: 0.5, fontStyle: 'italic' }}>No active DAG.</div>
          )}
        </div>
      </section>

      {/* 3. Live Execution Feed */}
      <section>
        <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
          Live Execution Feed
        </h4>
        <div style={{ 
          background: '#0d1117', 
          color: '#c9d1d9',
          padding: '12px', 
          borderRadius: '6px', 
          fontFamily: 'monospace', 
          fontSize: '0.85em',
          minHeight: '100px',
          maxHeight: '200px',
          overflowY: 'auto'
        }}>
          {activeTool ? (
            <>
              <div style={{ color: '#58a6ff' }}>[{activeTool}] {currentStep} → <span style={{ color: executionStatus === 'RUNNING' ? 'yellow' : executionStatus === 'FAILED' ? 'red' : 'green' }}>{executionStatus}</span></div>
              {lastResult && (
                <div style={{ marginTop: '8px', opacity: 0.8, whiteSpace: 'pre-wrap' }}>
                  {lastResult.length > 200 ? lastResult.slice(0, 200) + '...' : lastResult}
                </div>
              )}
            </>
          ) : (
            <div style={{ opacity: 0.5 }}>Idle...</div>
          )}
        </div>
      </section>

      {/* 4. Cognitive State Indicator */}
      <section>
        <h4 style={{ margin: '0 0 12px 0', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>
          Cognitive State
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85em' }}>
          <div style={{ padding: '8px', background: 'var(--bg-elevated)', borderRadius: '4px' }}>
            <div style={{ opacity: 0.7 }}>Phase Lock</div>
            <strong style={{ color: 'var(--success)' }}>STABLE</strong>
          </div>
          <div style={{ padding: '8px', background: 'var(--bg-elevated)', borderRadius: '4px' }}>
            <div style={{ opacity: 0.7 }}>Uncertainty</div>
            <strong style={{ color: chunkFailures > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {chunkFailures === 0 ? "LOW" : chunkFailures === 1 ? "MEDIUM" : "HIGH"}
            </strong>
          </div>
          <div style={{ padding: '8px', background: 'var(--bg-elevated)', borderRadius: '4px' }}>
            <div style={{ opacity: 0.7 }}>Replan Triggers</div>
            <strong>{chunkFailures}</strong>
          </div>
          <div style={{ padding: '8px', background: 'var(--bg-elevated)', borderRadius: '4px' }}>
            <div style={{ opacity: 0.7 }}>Oscillation Risk</div>
            <strong style={{ color: chunkFailures > 2 ? 'var(--error)' : 'var(--success)' }}>
              {chunkFailures > 2 ? "HIGH" : "LOW"}
            </strong>
          </div>
        </div>
      </section>

    </div>
  );
}
