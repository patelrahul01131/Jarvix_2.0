import React, { useState } from "react";
import { useStore } from "../store";

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onClearAll,
  onDeleteSession,
  handleClearAll,
  onRenameSession,
  agentStatus,
  devMode,
  onToggleDevMode,
  onMockRun,
}) {
  const store = useStore();
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Simplified array of sessions for now
  const sessionList = Object.values(sessions || {}).sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  const filteredSessions = sessionList.filter((s) =>
    (s.title || "Untitled").toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const startRename = (e, session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditTitle(session.title || "Untitled");
  };

  const saveRename = (id) => {
    if (editTitle.trim()) onRenameSession(id, editTitle.trim());
    setEditingId(null);
  };

  function formatTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  // Dynamic health data
  const activeSession = sessions[activeSessionId];
  const msgCount = activeSession?.messages?.length || 0;
  const memoryHealth = Math.max(0, 100 - msgCount * 2) + "%";

  const ctxCount = activeSession?.episodicMemory?.length || 0;
  const contextUsage = Math.min(100, ctxCount * 5) + "%";

  const statusHistory = store.statusHistory || [];
  const loopRisk =
    statusHistory.filter((s) => s.includes("Loop")).length > 0 ? "High" : "Low";

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header-section">
        <div className="brand">
          <i className="codicon codicon-hubot brand-icon"></i>
          <span className="brand-name">Jarvix</span>
        </div>
        <div
          className={`status-badge status-${(agentStatus || "IDLE").toLowerCase()}`}
        >
          {agentStatus || "IDLE"}
        </div>
      </div>

      {/* Actions */}
      <div className="sidebar-actions">
        <button className="new-chat-btn" onClick={onNewSession}>
          <i className="codicon codicon-add"></i> New Chat
        </button>
        <div className="search-box">
          <i className="codicon codicon-search"></i>
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Conversations */}
      <div className="sidebar-section-title">Conversations</div>
      <div className="sessions-list">
        {filteredSessions.length === 0 && (
          <div className="empty-sessions">No sessions found</div>
        )}
        {filteredSessions.map((session) => (
          <div
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? "active" : ""}`}
            onClick={() => onSelectSession(session.id)}
          >
            {editingId === session.id ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => saveRename(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveRename(session.id);
                  if (e.key === "Escape") setEditingId(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                className="session-edit-input"
              />
            ) : (
              <>
                <div className="session-info">
                  <div className="session-title">
                    {session.title || "Untitled"}
                  </div>
                  <div className="session-time">
                    {formatTime(session.createdAt)}
                  </div>
                </div>
                <div className="session-actions">
                  <button
                    onClick={(e) => startRename(e, session)}
                    title="Rename"
                  >
                    <i className="codicon codicon-edit"></i>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    title="Delete"
                  >
                    <i className="codicon codicon-trash"></i>
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="health-indicator">
          <div className="health-title">
            <i className="codicon codicon-pulse"></i> Agent Health
          </div>
          <div className="health-stat">
            Memory: <span className="good">{memoryHealth}</span>
          </div>
          <div className="health-stat">
            Context:{" "}
            <span className={parseInt(contextUsage) > 80 ? "warning" : "good"}>
              {contextUsage}
            </span>
          </div>
          <div className="health-stat">
            Loop Risk:{" "}
            <span className={loopRisk === "High" ? "error" : "good"}>
              {loopRisk}
            </span>
          </div>
        </div>

        <div className="footer-actions">
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={devMode}
              onChange={(e) => onToggleDevMode(e.target.checked)}
            />
            <span className="slider"></span>
            <span className="label-text">Developer Mode</span>
          </label>

          {devMode && (
            <button
              className="icon-btn"
              title="Run Mock Agent Loop"
              onClick={onMockRun}
            >
              <i
                className="codicon codicon-play"
                style={{ color: "var(--success)" }}
              ></i>
            </button>
          )}

          <div
            className="action-btn"
            title="Clear All Sessions"
            onClick={() => {
              if (confirm("Are you sure you want to clear all sessions?")) {
                handleClearAll();
              }
            }}
          >
            <i className="codicon codicon-trash cursor-pointer hover:text-red-500"></i>
          </div>
        </div>
      </div>
    </div>
  );
}
