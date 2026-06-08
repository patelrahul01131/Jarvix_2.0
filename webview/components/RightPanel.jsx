import { useState } from 'react';
import AgentStatusPanel from './AgentStatusPanel';
import ContextPanel from './ContextPanel';
import MemoryDashboard from './MemoryDashboard';

const TABS = [
  { id: 'context',  label: 'Context',  icon: '🎯' },
  { id: 'memory',   label: 'Memory',   icon: '🧠' },
];

export default function RightPanel({
  statusHistory,
  isLoading,
  messages,
  session,
  workspaceFiles,
}) {
  const [activeTab, setActiveTab] = useState('context');

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
      <div className="right-panel-content">
        {activeTab === 'context' && (
          <ContextPanel
            statusHistory={statusHistory}
            messages={messages}
            isLoading={isLoading}
          />
        )}
        {activeTab === 'memory' && (
          <MemoryDashboard
            session={session}
            messages={messages}
          />
        )}
      </div>
    </div>
  );
}
