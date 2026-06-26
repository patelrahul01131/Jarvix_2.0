import React from "react";
import ChatWindow from "./ChatWindow";
import AgentTimeline from "./AgentTimeline";
import ApprovalView from "./ApprovalView";
import PlanOverlay from "./PlanOverlay";
import ExecutionBar from "./ExecutionBar";
import Composer from "./Composer";

import { useStore } from "../store";

export default function AgentWorkspace({
  activeSession,
  messages,
  isLoading,
  statusHistory,
  streamingMessage,
}) {
  const store = useStore();
  // Placeholder status and states for now
  const agentStatus = activeSession?.agentStatus || "IDLE";

  return (
    <div className="agent-workspace">
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        statusHistory={statusHistory}
        streamingMessage={streamingMessage}
        activeSessionId={activeSession?.id}
        // Will pass down the Empty State quick-actions later
      />

      {agentStatus === "AWAITING_PLAN_APPROVAL" && (
        <PlanOverlay
          plan={
            activeSession?.pendingPlan || {
              goal: "Example Plan",
              risk: "Medium",
              files: ["auth.js"],
              commands: ["npm install bcrypt"],
              steps: ["Install dependencies", "Update auth logic"],
            }
          }
          onApprove={() => {}}
          onEdit={() => {}}
          onReject={() => {}}
        />
      )}

      {agentStatus === "AWAITING_COMMAND_APPROVAL" && (
        <div
          className="absolute-center-overlay"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
          }}
        >
          <ApprovalView
            approvalRequest={{
              type: "command",
              action: "npm install bcrypt",
              risk: "Low",
              reasoning: "Required for password hashing",
            }}
            onApprove={() => {}}
            onReject={() => {}}
            onAlwaysAllow={() => {}}
          />
        </div>
      )}

      {agentStatus === "EXECUTING" && (
        <ExecutionBar
          activeTool={activeSession?.activeTool}
          isPaused={false}
          onPause={() => {}}
          onResume={() => {}}
          onStop={() => store.handleStop()}
        />
      )}

      <Composer
        onSend={(text) => {
          console.log("[Jarvix Debug] AgentWorkspace onSend fired with text:", text);
          store.handleSend({ text });
        }}
        onStop={() => store.handleStop()}
        isLoading={isLoading}
        agentStatus={agentStatus}
      />
    </div>
  );
}
