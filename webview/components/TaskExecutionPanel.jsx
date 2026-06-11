import { useEffect, useRef } from 'react';
import { useStore } from '../store';

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  pending:  { icon: '⋯', color: 'var(--fg-muted)', label: 'Pending' },
  running:  { icon: null, color: 'var(--accent)',   label: 'Running' },
  retrying: { icon: '↻', color: '#f59e0b',          label: 'Retrying' },
  done:     { icon: '✓', color: 'var(--success)',   label: 'Done' },
  failed:   { icon: '✗', color: '#f85149',          label: 'Failed' },
};

const RUNTIME_LABELS = {
  IDLE:      { text: 'Idle',      dot: '#6b7280' },
  RUNNING:   { text: 'Running',   dot: '#22c55e' },
  PAUSED:    { text: 'Paused',    dot: '#f59e0b' },
  COMPLETED: { text: 'Complete',  dot: '#22c55e' },
  FAILED:    { text: 'Failed',    dot: '#f85149' },
  ABORTED:   { text: 'Aborted',   dot: '#f85149' },
};

// ── Spinner animation injected once ─────────────────────────────────────────
const SPIN_CSS = `
  @keyframes tep-spin { to { transform: rotate(360deg); } }
  @keyframes tep-pulse { 0%,100%{ opacity:.4 } 50%{ opacity:1 } }
  @keyframes tep-slide-in { from{ opacity:0; transform:translateY(4px) } to{ opacity:1; transform:none } }
`;
if (typeof document !== 'undefined' && !document.getElementById('tep-styles')) {
  const s = document.createElement('style');
  s.id = 'tep-styles';
  s.textContent = SPIN_CSS;
  document.head.appendChild(s);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function relativeTime(ts) {
  if (!ts) return '';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function Spinner({ size = 12 }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      border: `2px solid rgba(124,106,247,0.25)`,
      borderTopColor: 'var(--accent)',
      borderRadius: '50%',
      animation: 'tep-spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  );
}

// ── Phase grouping ────────────────────────────────────────────────────────────
function groupStepsByPhase(phases, steps, totalSteps) {
  if (phases && phases.length > 0) {
    return phases.map((ph) => ({
      name:  ph.name,
      steps: (ph.steps || []).map((s) => ({
        index:  s.index,
        action: s.action,
        ...(steps?.[s.index] || {}),
      })),
    }));
  }
  // Fallback: flat list of steps
  return [{
    name: 'Execution',
    steps: Array.from({ length: totalSteps || 0 }, (_, i) => ({
      index: i,
      action: steps?.[i]?.action || `Step ${i + 1}`,
      ...(steps?.[i] || {}),
    })),
  }];
}

// ── Step Row ─────────────────────────────────────────────────────────────────
function StepRow({ step, isLast }) {
  const cfg    = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
  const isRun  = step.status === 'running';
  const isRety = step.status === 'retrying';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      paddingLeft: '16px',
      position: 'relative',
      animation: 'tep-slide-in 0.2s ease',
    }}>
      {/* Connector line */}
      {!isLast && (
        <div style={{
          position: 'absolute', left: 5, top: 18, bottom: -4,
          width: 1, background: 'rgba(255,255,255,0.07)',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minHeight: 28 }}>
        {/* Status indicator */}
        <div style={{ flexShrink: 0, width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
          {isRun
            ? <Spinner size={11} />
            : isRety
              ? <span style={{ fontSize: 13, color: cfg.color, animation: 'tep-pulse 1.2s ease infinite' }}>{cfg.icon}</span>
              : <span style={{ fontSize: 12, color: cfg.color, fontWeight: 700 }}>{cfg.icon}</span>
          }
        </div>

        {/* Step content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 12, lineHeight: '1.5',
              color: isRun ? 'var(--fg)' : (step.status === 'done' ? 'var(--fg-muted)' : 'var(--fg)'),
              wordBreak: 'break-all',
            }}>
              {step.action || `Step ${step.index + 1}`}
            </span>

            {step.tool && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(124,106,247,0.15)', color: '#a78bfa', flexShrink: 0,
              }}>
                {step.tool}
              </span>
            )}

            {isRety && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(245,158,11,0.15)', color: '#f59e0b', flexShrink: 0,
              }}>
                retry {step.retryCount}/{step.maxRetries || 3}
              </span>
            )}
          </div>

          {/* Retry / error details */}
          {isRety && step.retryReason && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#f59e0b', opacity: 0.9 }}>
              ↻ {step.retryReason}
            </div>
          )}

          {/* Verification checks */}
          {step.status === 'done' && step.verificationChecks?.length > 0 && (
            <div style={{ marginTop: 2 }}>
              {step.verificationChecks.slice(0, 2).map((c, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--fg-muted)', opacity: 0.7 }}>{c}</div>
              ))}
            </div>
          )}

          {/* Verification issues */}
          {step.verificationIssues?.length > 0 && (
            <div style={{ marginTop: 2 }}>
              {step.verificationIssues.map((iss, i) => (
                <div key={i} style={{ fontSize: 10, color: '#f85149' }}>✗ {iss}</div>
              ))}
            </div>
          )}

          {/* Checkpoint badge */}
          {step.status === 'done' && step.checkpointedAt && (
            <div style={{ marginTop: 2, fontSize: 10, color: 'var(--fg-muted)', opacity: 0.55 }}>
              🔖 checkpoint saved
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Phase Section ─────────────────────────────────────────────────────────────
function PhaseSection({ phase, isLast }) {
  const steps      = phase.steps || [];
  const doneCount  = steps.filter(s => s.status === 'done').length;
  const hasRunning = steps.some(s => s.status === 'running' || s.status === 'retrying');
  const hasFailed  = steps.some(s => s.status === 'failed');
  const allDone    = doneCount === steps.length && steps.length > 0;

  const phaseColor = hasFailed  ? '#f85149'
                   : hasRunning ? 'var(--accent)'
                   : allDone    ? 'var(--success)'
                   : 'var(--fg-muted)';

  const phaseIcon = hasFailed  ? '✗'
                  : allDone    ? '✓'
                  : hasRunning ? null
                  : '⋯';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Phase header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!phaseIcon
            ? <Spinner size={10} />
            : <span style={{ fontSize: 11, color: phaseColor, fontWeight: 700 }}>{phaseIcon}</span>
          }
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: phaseColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {phase.name}
        </span>
        {steps.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', marginLeft: 'auto' }}>
            {doneCount}/{steps.length}
          </span>
        )}
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {steps.map((step, i) => (
          <StepRow key={step.index} step={step} isLast={i === steps.length - 1} />
        ))}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TaskExecutionPanel() {
  const executionProgress = useStore(s => s.executionProgress);
  const isLoading         = useStore(s => s.isLoading);
  const handleRuntimePause  = useStore(s => s.handleRuntimePause);
  const handleRuntimeResume = useStore(s => s.handleRuntimeResume);
  const handleRuntimeAbort  = useStore(s => s.handleRuntimeAbort);

  const scrollRef = useRef(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [executionProgress?.lastEventAt]);

  // Only render when there's active execution data
  if (!executionProgress || !executionProgress.planId) return null;
  if (!isLoading && executionProgress.runtimeState === 'IDLE') return null;

  const { phases, steps, runtimeState, totalSteps, checkpointedAt, lastEventAt } = executionProgress;
  const rtLabel = RUNTIME_LABELS[runtimeState] || RUNTIME_LABELS.IDLE;
  const phaseGroups = groupStepsByPhase(phases, steps, totalSteps);

  const completedCount = Object.values(steps || {}).filter(s => s.status === 'done').length;
  const progress = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

  return (
    <div style={{
      border: '1px solid rgba(124,106,247,0.25)',
      borderRadius: 'var(--radius-md, 8px)',
      background: 'rgba(124,106,247,0.04)',
      overflow: 'hidden',
      animation: 'tep-slide-in 0.25s ease',
    }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.15)',
      }}>
        {runtimeState === 'RUNNING' ? <Spinner size={10} /> : (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: rtLabel.dot, flexShrink: 0, display: 'inline-block' }} />
        )}
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg)', letterSpacing: '0.04em' }}>
          EXECUTION RUNTIME
        </span>
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
          background: runtimeState === 'RUNNING'   ? 'rgba(34,197,94,0.15)'  :
                      runtimeState === 'FAILED'    ? 'rgba(248,81,73,0.15)'  :
                      runtimeState === 'COMPLETED' ? 'rgba(34,197,94,0.15)'  :
                      runtimeState === 'PAUSED'    ? 'rgba(245,158,11,0.15)' :
                      'rgba(107,114,128,0.15)',
          color: rtLabel.dot,
          marginLeft: 'auto',
        }}>
          {rtLabel.text}
        </span>

        {/* Control buttons */}
        <div style={{ display: 'flex', gap: 4 }}>
          {runtimeState === 'RUNNING' && (
            <button
              onClick={handleRuntimePause}
              title="Pause after current step"
              style={{
                background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)',
                color: '#f59e0b', borderRadius: 4, padding: '2px 7px', fontSize: 10,
                cursor: 'pointer', fontWeight: 600,
              }}>
              ⏸
            </button>
          )}
          {runtimeState === 'PAUSED' && (
            <button
              onClick={() => handleRuntimeResume()}
              title="Resume execution"
              style={{
                background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
                color: '#22c55e', borderRadius: 4, padding: '2px 7px', fontSize: 10,
                cursor: 'pointer', fontWeight: 600,
              }}>
              ▶
            </button>
          )}
          {(runtimeState === 'RUNNING' || runtimeState === 'PAUSED') && (
            <button
              onClick={handleRuntimeAbort}
              title="Abort execution"
              style={{
                background: 'rgba(248,81,73,0.15)', border: '1px solid rgba(248,81,73,0.3)',
                color: '#f85149', borderRadius: 4, padding: '2px 7px', fontSize: 10,
                cursor: 'pointer', fontWeight: 600,
              }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Progress bar ───────────────────────────────────────────────────── */}
      <div style={{ height: 2, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: runtimeState === 'FAILED' ? '#f85149' : 'linear-gradient(90deg, #7c6af7, #a78bfa)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* ── Step details ───────────────────────────────────────────────────── */}
      <div
        ref={scrollRef}
        style={{
          maxHeight: 320,
          overflowY: 'auto',
          padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        {phaseGroups.map((ph, i) => (
          <PhaseSection key={ph.name + i} phase={ph} isLast={i === phaseGroups.length - 1} />
        ))}

        {/* Terminal states */}
        {runtimeState === 'COMPLETED' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
          }}>
            <span style={{ fontSize: 13 }}>✅</span>
            <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
              All {completedCount} steps completed successfully
            </span>
          </div>
        )}
        {runtimeState === 'FAILED' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.2)',
          }}>
            <span style={{ fontSize: 13 }}>🛑</span>
            <span style={{ fontSize: 12, color: '#f85149', fontWeight: 600 }}>
              Execution escalated — manual intervention required
            </span>
          </div>
        )}
      </div>

      {/* ── Footer: checkpoint info ────────────────────────────────────────── */}
      {checkpointedAt && (
        <div style={{
          padding: '5px 14px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', opacity: 0.6 }}>
            🔖 Checkpoint — {relativeTime(lastEventAt)}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-muted)', opacity: 0.5 }}>
            {completedCount}/{totalSteps} steps
          </span>
        </div>
      )}
    </div>
  );
}
