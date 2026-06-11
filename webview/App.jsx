import { useEffect } from 'react';
import { useStore } from './store';
import ChatWindow from './components/ChatWindow';
import ModelSelector from './components/ModelSelector';
import InputBar from './components/InputBar';
import SessionSidebar from './components/SessionSidebar';
import RightPanel from './components/RightPanel';
import WorkspacePanel from './components/WorkspacePanel';

export default function App() {
  const store = useStore();

  useEffect(() => {
    store.init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSession = store.sessions[store.activeSessionId];
  const messages      = activeSession?.messages || [];

  return (
    <div className="app">
      {/* Left sidebar */}
      <SessionSidebar
        sessions={store.sessions}
        activeSessionId={store.activeSessionId}
        onSelectSession={store.setActiveSessionId}
        onNewSession={store.handleNewSession}
        onClearAll={store.handleClearAll}
        onDeleteSession={store.handleDeleteSession}
        onRenameSession={store.handleRenameSession}
      />

      {/* Middle panes container */}
      <div className="main">
        
        {/* Chat / Timeline Pane */}
        <div className="timeline-pane">
          <div className="top-bar">
            <ModelSelector
              activeProvider={store.activeProvider}
              activeModel={store.activeModel}
              onProviderChange={store.setActiveProvider}
              onModelChange={store.setActiveModel}
              disabled={store.isLoading}
            />

            <div className="plan-mode-toggle">
              <input
                type="checkbox"
                id="planModeToggle"
                checked={store.planModeEnabled}
                onChange={e => store.setPlanModeEnabled(e.target.checked)}
                disabled={store.isLoading}
              />
              <label htmlFor="planModeToggle">📋 Plan mode</label>
            </div>

            {activeSession?.agentStatus && (
              <div className={`agent-status-badge ${activeSession.agentStatus.toLowerCase().includes('error') ? 'error' : activeSession.agentStatus.toLowerCase().includes('thinking') ? 'thinking' : activeSession.agentStatus.toLowerCase().includes('executing') ? 'executing' : ''}`}>
                {activeSession.agentStatus}
              </div>
            )}

            <button
              className={`right-panel-toggle-btn ${store.rightPanelOpen ? 'active' : ''}`}
              onClick={() => store.setRightPanelOpen(!store.rightPanelOpen)}
              title={store.rightPanelOpen ? 'Hide context panel' : 'Show context panel'}
              style={{ marginLeft: 'auto' }}
            >
              {store.rightPanelOpen ? '◧ Hide HUD' : '◨ Agent HUD'}
            </button>
          </div>

          <ChatWindow
            messages={messages}
            isLoading={store.isLoading}
            statusHistory={store.statusHistory}
            streamingMessage={store.streamingMessage}
            activeSessionId={store.activeSessionId}
          />

          <InputBar
            onSend={store.handleSend}
            onStop={store.handleStop}
            isLoading={store.isLoading}
            workspaceFiles={store.workspaceFiles}
          />
        </div>

        {/* Center Workspace Pane */}
        {store.activeWorkspaceView && (
          <div className="workspace-pane">
            <WorkspacePanel 
              activeSession={activeSession}
              activeView={store.activeWorkspaceView}
            />
          </div>
        )}

      </div>

      {/* Right panel */}
      {store.rightPanelOpen && (
        <RightPanel
          statusHistory={store.statusHistory}
          isLoading={store.isLoading}
          messages={messages}
          session={activeSession}
          workspaceFiles={store.workspaceFiles}
          liveAgentState={store.liveAgentState}
        />
      )}
    </div>
  );
}