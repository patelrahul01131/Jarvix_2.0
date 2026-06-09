import { useState } from 'react';
import ContextPanel from './ContextPanel';
import MemoryDashboard from './MemoryDashboard';
import TimelinePanel from './TimelinePanel';
import DeveloperToolsPanel from './DeveloperToolsPanel';
import TelemetryPanel from './TelemetryPanel';

const TABS = [
  { id: 'telemetry', label: 'Telemetry', icon: '⚡' },
  { id: 'context',  label: 'Context',  icon: '🎯' },
  { id: 'memory',   label: 'Memory',   icon: '🧠' },
  { id: 'timeline', label: 'Timeline', icon: '⏱️' },
  { id: 'dev',      label: 'Dev Tools', icon: '🛠️' }
];

export default function RightPanel({
  statusHistory,
  isLoading,
  messages,
  session,
  workspaceFiles,
  liveAgentState,
}) {
  const [activeTab, setActiveTab] = useState('telemetry');

  return (
    <div className="right-panel">
      {/* Tab bar */}
      <div className="right-panel-header">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`right-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="right-panel-content" style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'telemetry' && (
          <TelemetryPanel
            liveAgentState={liveAgentState}
            session={session}
          />
        )}
        {activeTab === 'context' && (
          <ContextPanel
            statusHistory={statusHistory}
            messages={messages}
            session={session}
            isLoading={isLoading}
          />
        )}
        {activeTab === 'memory' && (
          <MemoryDashboard
            session={session}
            messages={messages}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelinePanel
            session={session}
          />
        )}
        {activeTab === 'dev' && (
          <DeveloperToolsPanel
            session={session}
            messages={messages}
          />
        )}
      </div>
    </div>
  );
}
