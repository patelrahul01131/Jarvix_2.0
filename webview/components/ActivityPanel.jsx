import { useState, useEffect, useRef } from 'react';

// Map status strings to icons
function getStatusIcon(status) {
  if (!status) return '⚙️';
  if (status.includes('Scanning')) return '🔍';
  if (status.includes('Analyzing')) return '📂';
  if (status.includes('Reading')) return '📖';
  if (status.includes('Writing') || status.includes('Preparing')) return '✍️';
  if (status.includes('Thinking')) return '🤖';
  if (status.includes('Preparing response')) return '💬';
  if (status.includes('create') || status.includes('Will create')) return '📝';
  return '⚙️';
}

// Extract filename from a status string like "📖 Reading agent.js..."
function extractFilename(status) {
  const match = status.match(/(?:Reading|Writing|Preparing|create)\s+([^\s.]+\.[a-zA-Z]{1,6})/i);
  return match ? match[1] : null;
}

export default function ActivityPanel({ statusHistory, isLoading }) {
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  // Start elapsed timer when loading begins
  useEffect(() => {
    if (isLoading) {
      startTimeRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isLoading]);

  if (!isLoading && statusHistory.length === 0) return null;

  const thinkingStep = statusHistory.find(s => s.includes('Thinking') || s.includes('Preparing response'));

  return (
    <div className="activity-panel">
      <div className="activity-panel-header">
        <span className="activity-spinner" />
        <span className="activity-label">
          Jarvix is working
          {elapsed > 0 && <span className="activity-elapsed"> · {elapsed}s</span>}
        </span>
      </div>

      <div className="activity-steps">
        {statusHistory.map((status, idx) => {
          const icon = getStatusIcon(status);
          const filename = extractFilename(status);
          const isThinking = status.includes('Thinking') || status.includes('Preparing response');
          const isExpanded = expandedIndex === idx;

          return (
            <div
              key={idx}
              className={`activity-step ${isExpanded ? 'expanded' : ''}`}
              onClick={() => setExpandedIndex(isExpanded ? null : idx)}
            >
              <div className="activity-step-row">
                <span className="activity-step-icon">{icon}</span>
                <span className="activity-step-text">
                  {/* Strip the emoji prefix from status since we render the icon separately */}
                  {status.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\s]+/u, '').trim()}
                </span>
                {filename && (
                  <span className="activity-step-tag">{filename}</span>
                )}
                {isThinking && elapsed > 0 && (
                  <span className="activity-step-timer">{elapsed}s</span>
                )}
                <span className="activity-step-chevron">{isExpanded ? '▾' : '▸'}</span>
              </div>

              {isExpanded && (
                <div className="activity-step-detail">
                  {isThinking ? (
                    <span className="activity-detail-text">
                      🤖 Model is processing your request and generating a response...
                      {elapsed > 0 && ` (${elapsed}s elapsed)`}
                    </span>
                  ) : filename ? (
                    <span className="activity-detail-text">
                      File: <code>{filename}</code> — {status.toLowerCase().includes('reading') ? 'Loading file content for context' : 'Preparing file changes to write'}
                    </span>
                  ) : (
                    <span className="activity-detail-text">{status}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Live pulsing current step if still loading */}
        {isLoading && (
          <div className="activity-step active">
            <div className="activity-step-row">
              <span className="activity-step-icon">
                {statusHistory.length > 0 ? getStatusIcon(statusHistory[statusHistory.length - 1]) : '⚙️'}
              </span>
              <span className="activity-step-text activity-pulse">
                {statusHistory.length > 0
                  ? statusHistory[statusHistory.length - 1].replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\s]+/u, '').trim()
                  : 'Starting up...'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
