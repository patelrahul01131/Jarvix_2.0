import { useEffect } from "react";
import { useStore } from "./store";
import SessionSidebar from "./components/SessionSidebar";
import AgentWorkspace from "./components/AgentWorkspace";
import RightPanel from "./components/RightPanel";

export default function App() {
  const store = useStore();

  useEffect(() => {
    store.init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSession = store.sessions[store.activeSessionId];
  const messages = activeSession?.messages || [];

  return (
    <div
      className={`app-grid ${store.rightPanelOpen ? "right-panel-open" : ""}`}
    >
      <SessionSidebar
        sessions={store.sessions}
        activeSessionId={store.activeSessionId}
        onSelectSession={store.setActiveSessionId}
        onNewSession={store.handleNewSession}
        onClearAll={store.handleClearAll}
        onDeleteSession={store.handleDeleteSession}
        handleClearAll={store.handleClearAll}
        onRenameSession={store.handleRenameSession}
        agentStatus={activeSession?.agentStatus}
        devMode={store.devModeEnabled}
        onToggleDevMode={store.setDevModeEnabled}
      />

      <AgentWorkspace
        activeSession={activeSession}
        messages={messages}
        isLoading={store.isLoading}
        statusHistory={store.statusHistory}
        streamingMessage={store.streamingMessage}
      />

      {store.rightPanelOpen && (
        <RightPanel
          session={activeSession}
          messages={messages}
          devMode={store.devModeEnabled}
        />
      )}
    </div>
  );
}
