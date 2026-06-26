import React, { useState, useEffect } from 'react';

export default function ExecutionBar({ activeTool, isPaused, onPause, onResume, onStop }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (isPaused) return;
    
    const interval = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isPaused]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="execution-bar">
      <div className="execution-bar-content">
        <div className="execution-icon">
          {isPaused ? (
            <i className="codicon codicon-debug-pause" style={{ color: 'var(--warning)' }}></i>
          ) : (
            <i className="codicon codicon-loading codicon-modifier-spin" style={{ color: 'var(--accent)' }}></i>
          )}
        </div>
        <div className="execution-details">
          <div className="execution-title">
            {isPaused ? 'Execution Paused' : (activeTool ? `Running ${activeTool}` : 'Executing Agent Task...')}
          </div>
          <div className="execution-meta">
            Elapsed: {formatTime(elapsed)}
          </div>
        </div>
      </div>
      <div className="execution-actions">
        {isPaused ? (
          <button className="exec-btn resume" onClick={onResume} title="Resume">
            <i className="codicon codicon-play"></i> Resume
          </button>
        ) : (
          <button className="exec-btn pause" onClick={onPause} title="Pause">
            <i className="codicon codicon-debug-pause"></i> Pause
          </button>
        )}
        <button className="exec-btn stop" onClick={onStop} title="Stop">
          <i className="codicon codicon-debug-stop"></i> Stop
        </button>
      </div>
    </div>
  );
}
