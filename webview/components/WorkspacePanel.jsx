import React from "react";
import FileDiffViewer from "./FileDiffViewer";
import { useStore } from "../store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function WorkspacePanel({ activeSession, activeView }) {
  const store = useStore();

  if (!activeView || !activeSession) {
    return null;
  }

  const message = activeSession.messages[activeView.messageIndex];
  if (!message) return null;

  if (activeView.type === "plan") {
    return (
      <div className="workspace-content">
        <div
          className="workspace-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h2>📋 Implementation Plan</h2>
            {message.planStatus === "approved" ? (
              <span className="plan-status-approved">✅ Approved</span>
            ) : (
              <span className="plan-status-pending">⏳ Awaiting Review</span>
            )}
          </div>
          <button
            className="workspace-close-btn"
            onClick={() => store.setActiveWorkspaceView(null)}
            title="Close Workspace"
          >
            ✕
          </button>
        </div>
        <div className="workspace-body markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>

          {message.planStatus !== "approved" && store.handleApprovePlan && (
            <div className="workspace-actions">
              <button
                className="plan-approve-btn"
                onClick={() => store.handleApprovePlan(activeView.messageIndex)}
                style={{ marginTop: "20px" }}
              >
                🚀 Approve & Execute Plan
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeView.type === "diff" && activeView.fileIndex !== undefined) {
    if (!message.fileEdits) return null;
    const edit = message.fileEdits[activeView.fileIndex];
    if (!edit) return null;

    return (
      <div className="workspace-content">
        <div
          className="workspace-header"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2>📄 File Diff: {(edit.filePath || edit.path || '').split(/[/\\]/).pop() || '(unnamed)'}</h2>
          <button
            className="workspace-close-btn"
            onClick={() => store.setActiveWorkspaceView(null)}
            title="Close Workspace"
          >
            ✕
          </button>
        </div>
        <div className="workspace-body">
          <FileDiffViewer
            edit={edit}
            onAccept={(editedCode) =>
              store.handleAcceptFile(
                activeView.messageIndex,
                activeView.fileIndex,
                editedCode,
              )
            }
            onDecline={() =>
              store.handleDeclineFile(
                activeView.messageIndex,
                activeView.fileIndex,
              )
            }
            onViewDiff={() =>
              store.handleViewDiff(
                activeView.messageIndex,
                activeView.fileIndex,
              )
            }
          />
        </div>
      </div>
    );
  }

  return null;
}
