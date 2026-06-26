import { useEffect, useRef, useState } from "react";
import TaskExecutionPanel from "./TaskExecutionPanel";
import SupervisorDashboard from "./SupervisorDashboard";

export default function AgentStatusPanel({ statusHistory, isLoading }) {
  const containerRef = useRef(null);
  const [loopDetected, setLoopDetected] = useState(false);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }

    // Check for loop error in the latest statuses
    const hasLoop = statusHistory.some((s) => s.includes("Loop Detected"));
    setLoopDetected(hasLoop);
  }, [statusHistory]);

  if (!isLoading && (!statusHistory || statusHistory.length === 0)) return null;

  return (
    <div
      className="agent-status-panel"
      style={{ display: "flex", flexDirection: "column", gap: "8px" }}
    >
      {/* ── Supervisor Live Dashboard ── */}
      <SupervisorDashboard />

      {/* ── Task Execution Runtime Panel (shows during plan execution) ── */}
      <TaskExecutionPanel />

      {/* Loop Detection Banner */}
      {loopDetected && (
        <div
          style={{
            background: "rgba(248, 81, 73, 0.1)",
            border: "1px solid #f85149",
            borderRadius: "6px",
            padding: "12px",
            color: "#ff7b72",
            fontSize: "13px",
          }}
        >
          <div
            style={{
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <span>⚠️</span> Potential Loop Detected
          </div>
          <div>
            The agent appears to be repeating the same action without making
            progress.
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button
              style={{
                background: "#f85149",
                color: "#fff",
                border: "none",
                padding: "4px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              Stop Agent
            </button>
          </div>
        </div>
      )}

      {/* Progress Tracker */}
      <div
        style={{
          border: "1px solid rgba(124, 106, 247, 0.2)",
          borderRadius: "var(--radius-md)",
          background: "rgba(124, 106, 247, 0.04)",
          padding: "12px",
        }}
      >
        <div
          className="agent-status-title"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginBottom: "8px",
          }}
        >
          {isLoading && !loopDetected && (
            <span
              className="activity-spinner"
              style={{
                width: "10px",
                height: "10px",
                border: "2px solid rgba(124,106,247,0.3)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
          )}
          <span style={{ fontWeight: "600" }}>Agent Progress Tracker</span>
        </div>

        <div
          className="agent-pipeline"
          ref={containerRef}
          style={{
            maxHeight: "250px",
            overflowY: "auto",
            paddingRight: "4px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {statusHistory.map((status, idx) => {
            const isLatest = idx === statusHistory.length - 1;
            const isActive = isLoading && isLatest && !loopDetected;

            // Parse timestamp: [10:32:11] [BADGE] Text
            let time = "";
            let badge = "";
            let text = status;

            const timeMatch = status.match(/^\[(.*?)\]\s*(.*)$/);
            if (timeMatch) {
              time = timeMatch[1];
              text = timeMatch[2];
            }

            const badgeMatch = text.match(/^\[([A-Z_]+)\]\s*(.*)$/);
            if (badgeMatch) {
              badge = badgeMatch[1];
              text = badgeMatch[2];
            }

            let icon = isActive ? "⏳" : "✓";
            if (
              status.includes("Loop Detected") ||
              status.includes("❌") ||
              status.includes("⚠️")
            )
              icon = "❌";

            return (
              <div
                key={idx}
                className={`pipeline-step ${isActive ? "active" : "done"}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  opacity: isActive || status.includes("Loop") ? 1 : 0.7,
                }}
              >
                <span
                  className="pipeline-icon"
                  style={{ fontSize: "13px", marginTop: "2px" }}
                >
                  {icon}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {time && (
                      <span
                        style={{
                          fontSize: "10px",
                          color: "var(--fg-muted)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {time}
                      </span>
                    )}
                    {badge && (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: "700",
                          background: "rgba(124,106,247,0.2)",
                          color: "#a78bfa",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          flexShrink: 0,
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      color: status.includes("❌")
                        ? "#ff7b72"
                        : isActive
                          ? "var(--fg)"
                          : "var(--fg-muted)",
                      fontSize: "12px",
                      lineHeight: "1.4",
                      marginTop: "2px",
                      wordBreak: "break-word",
                    }}
                  >
                    {text}
                  </span>
                </div>
              </div>
            );
          })}
          {!isLoading && statusHistory.length > 0 && !loopDetected && (
            <div
              className="pipeline-step done"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "4px 8px",
              }}
            >
              <span className="pipeline-icon">✅</span>
              <span
                className="pipeline-label"
                style={{
                  color: "var(--success)",
                  fontSize: "12px",
                  fontWeight: "bold",
                }}
              >
                Task Completed
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
