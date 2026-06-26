import React, { useEffect, useRef } from 'react';

const STATES = [
  'IDLE', 'CLASSIFYING', 'EXTRACTING', 'PLANNING', 'VALIDATING', 
  'AWAITING', 'EXECUTING', 'OBSERVING', 'VERIFYING', 'REFLECTING', 
  'EVALUATING', 'REPLANNING', 'COMPACTING', 'COMPLETED', 'FAILED'
];

export default function AgentTimeline({ status }) {
  const containerRef = useRef(null);

  // Fallback to IDLE if no status
  const currentStatus = (status || 'IDLE').toUpperCase();
  let currentIndex = STATES.indexOf(currentStatus);
  
  // If it's a specific wait state, map it
  if (currentStatus === 'AWAITING_PLAN_APPROVAL' || currentStatus === 'AWAITING_COMMAND_APPROVAL') {
    currentIndex = STATES.indexOf('AWAITING');
  }

  // If status is not in the array exactly, find best match or default to 0
  if (currentIndex === -1) currentIndex = 0;

  // Auto-scroll to active item
  useEffect(() => {
    if (containerRef.current) {
      const activeEl = containerRef.current.querySelector('.timeline-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [currentIndex]);

  return (
    <div className="agent-timeline" ref={containerRef}>
      {STATES.map((st, i) => {
        const isActive = i === currentIndex;
        const isPast = i < currentIndex;
        const isFailed = st === 'FAILED' && currentStatus === 'FAILED';
        
        // Hide FAILED from the default timeline unless we are actually failed
        if (st === 'FAILED' && currentStatus !== 'FAILED') return null;
        
        let className = 'timeline-item';
        if (isActive) className += ' active';
        else if (isPast) className += ' completed';
        
        if (isFailed) className += ' failed';

        return (
          <React.Fragment key={st}>
            <div className={className}>
              <div className="timeline-node">
                {isPast ? <i className="codicon codicon-check"></i> : 
                 isActive ? <i className="codicon codicon-loading codicon-modifier-spin"></i> : 
                 isFailed ? <i className="codicon codicon-error"></i> : null}
              </div>
              <div className="timeline-label">{st}</div>
            </div>
            {i < STATES.length - 1 && st !== 'COMPLETED' && (
              <div className={`timeline-connector ${isPast ? 'completed' : ''}`}></div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
