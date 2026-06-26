import React from 'react';
import { useStore } from '../store';

export default function SupervisorDashboard() {
  const liveAgentState = useStore((state) => state.liveAgentState);

  if (!liveAgentState || !liveAgentState.phase) {
    return null;
  }

  const {
    phase,
    currentStep,
    goal,
    intent,
    contextTokens,
    retrievedContext,
    budget,
    plan,
    selectedSkills,
    reflection
  } = liveAgentState;

  // Derive budget percentage
  let budgetPercent = 0;
  if (budget?.maxTokens) {
    budgetPercent = Math.min(100, Math.round(((budget.tokensUsed || contextTokens || 0) / budget.maxTokens) * 100));
  } else if (contextTokens) {
    budgetPercent = Math.min(100, Math.round((contextTokens / 20000) * 100));
  }

  const getPhaseColor = (p) => {
    switch (p) {
      case 'PLANNING': return '#3fb950'; // Green
      case 'ASSEMBLING_CONTEXT': return '#a371f7'; // Purple
      case 'EXECUTING_SKILLS': return '#d29922'; // Yellow/Orange
      case 'REFLECTING': return '#2f81f7'; // Blue
      default: return '#8b949e'; // Gray
    }
  };

  return (
    <div className="supervisor-dashboard" style={{
      border: '1px solid rgba(124, 106, 247, 0.3)',
      borderRadius: '8px',
      background: 'rgba(20, 20, 20, 0.6)',
      padding: '12px',
      marginBottom: '12px',
      fontFamily: 'var(--font-sans)',
      color: 'var(--fg)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: getPhaseColor(phase), boxShadow: `0 0 8px ${getPhaseColor(phase)}` }}></div>
          <span style={{ fontWeight: 'bold', fontSize: '13px', letterSpacing: '0.5px' }}>SUPERVISOR CORE</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--fg-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '12px' }}>
          {phase.replace('_', ' ')}
        </div>
      </div>

      {/* Goal & Intent */}
      {(goal || intent) && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px', color: '#a371f7' }}>Goal & Intent</div>
          <div style={{ fontSize: '13px', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '4px' }}>
            <div style={{ marginBottom: '4px' }}><strong>Goal:</strong> {goal || 'Extracting...'}</div>
            {intent && <div><strong>Intent:</strong> {intent}</div>}
          </div>
        </div>
      )}

      {/* Context Budget */}
      {contextTokens > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
            <span style={{ fontWeight: '600', color: '#3fb950' }}>Context Budget</span>
            <span>{contextTokens} / 20k tokens</span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${budgetPercent}%`, background: budgetPercent > 90 ? '#f85149' : '#3fb950', transition: 'width 0.3s ease' }}></div>
          </div>
          {retrievedContext !== undefined && (
            <div style={{ fontSize: '10px', color: 'var(--fg-muted)', marginTop: '4px' }}>
              Items retrieved: {retrievedContext}
            </div>
          )}
        </div>
      )}

      {/* Skills Pipeline */}
      {selectedSkills && selectedSkills.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '6px', color: '#d29922' }}>Skill Pipeline</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {selectedSkills.map((skill, idx) => (
              <div key={idx} style={{ 
                fontSize: '11px', 
                padding: '2px 6px', 
                background: 'rgba(210, 153, 34, 0.15)', 
                color: '#d29922', 
                border: '1px solid rgba(210, 153, 34, 0.3)', 
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <i className="codicon codicon-symbol-property" style={{ fontSize: '10px' }}></i>
                {skill.name || skill}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reflection */}
      {reflection && (
        <div style={{ marginTop: '12px', background: reflection.passed ? 'rgba(63, 185, 80, 0.1)' : 'rgba(248, 81, 73, 0.1)', padding: '8px', borderRadius: '4px', border: `1px solid ${reflection.passed ? 'rgba(63, 185, 80, 0.3)' : 'rgba(248, 81, 73, 0.3)'}` }}>
          <div style={{ fontSize: '12px', fontWeight: 'bold', color: reflection.passed ? '#3fb950' : '#f85149', marginBottom: '4px' }}>
            {reflection.passed ? '✅ Verification Passed' : '⚠️ Execution Failed'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--fg)' }}>{reflection.message}</div>
          {!reflection.passed && reflection.recoveryPlan && (
            <div style={{ marginTop: '6px', fontSize: '11px' }}>
              <strong>Recovery Plan:</strong> {reflection.recoveryPlan.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Current Step Footer */}
      {currentStep && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: '11px', color: 'var(--fg-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="codicon codicon-loading codicon-modifier-spin"></i>
          {currentStep}
        </div>
      )}
    </div>
  );
}
