import React, { useState } from 'react';

import PlanTab from './tabs/PlanTab';
import ChangesTab from './tabs/ChangesTab';
import CommandsTab from './tabs/CommandsTab';
import ObservationsTab from './tabs/ObservationsTab';
import WorldStateTab from './tabs/WorldStateTab';
import ActivityTab from './tabs/ActivityTab';
import ContextTab from './tabs/ContextTab';
import BeliefsTab from './tabs/BeliefsTab';

export default function RightPanel({ session, messages, devMode = true }) {
  const [activeTab, setActiveTab] = useState('plan');

  const tabs = [
    { id: 'plan', label: 'Plan', icon: 'list-flat' },
    { id: 'changes', label: 'Changes', icon: 'git-compare' },
    { id: 'commands', label: 'Commands', icon: 'terminal' },
    { id: 'observations', label: 'Observations', icon: 'eye' },
    { id: 'world_state', label: 'World State', icon: 'globe' },
    { id: 'activity', label: 'Activity', icon: 'history' },
    { id: 'context', label: 'Context', icon: 'symbol-misc' }
  ];

  if (devMode) {
    tabs.push({ id: 'beliefs', label: 'Beliefs', icon: 'lightbulb' });
  }

  return (
    <div className="right-panel">
      <div className="tabs-header">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            <i className={`codicon codicon-${tab.icon}`}></i>
          </button>
        ))}
      </div>
      
      <div className="tab-content">
        {activeTab === 'plan' && <PlanTab plan={session?.pendingPlan} />}
        {activeTab === 'changes' && <ChangesTab changes={session?.changes} />}
        {activeTab === 'commands' && <CommandsTab commands={session?.commands} />}
        {activeTab === 'observations' && <ObservationsTab observations={session?.observations} />}
        {activeTab === 'world_state' && <WorldStateTab worldState={session?.worldState} />}
        {activeTab === 'activity' && <ActivityTab activities={session?.activities} />}
        {activeTab === 'context' && <ContextTab contextData={session?.contextData} />}
        {activeTab === 'beliefs' && <BeliefsTab beliefs={session?.beliefs} />}
      </div>
    </div>
  );
}
