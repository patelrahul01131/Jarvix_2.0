import { useMemo } from "react";

export default function MemoryDashboard({ session, messages }) {
  const taskMemory = session?.taskMemory || {};
  const workingMemory = session?.workingMemory || {};
  const failureMemory = session?.failureMemory || [];

  // Derive current goal
  const currentGoal = useMemo(() => {
    return taskMemory.goal || "No goal established";
  }, [taskMemory.goal]);

  // Derive last observation
  const lastObservation = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "system")
        return (
          messages[i].content.slice(0, 80) +
          (messages[i].content.length > 80 ? "..." : "")
        );
    }
    return "No recent observations";
  }, [messages]);

  const activeFiles = Array.isArray(workingMemory.activeFiles)
    ? workingMemory.activeFiles
    : [];
  const sessionAge = session?.createdAt
    ? Math.floor((Date.now() - session.createdAt) / 60000)
    : 0;

  const failureCount = failureMemory.length;

  return (
    <div
      className="memory-dashboard"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        padding: "12px",
      }}
    >
      {/* Short-Term Memory */}
      <div
        className="memory-tier short-term"
        style={{
          background: "var(--bg-elevated)",
          borderRadius: "6px",
          padding: "12px",
        }}
      >
        <div
          style={{
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "12px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            paddingBottom: "6px",
          }}
        >
          <span className="memory-tier-dot" style={{ background: "#60a5fa" }} />
          <span>Short-Term Memory</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              Last Observation
            </div>
            <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)" }}>
              {lastObservation}
            </div>
          </div>
          {failureCount > 0 && (
            <div>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--fg-muted)",
                  textTransform: "uppercase",
                  marginBottom: "2px",
                }}
              >
                Failure Count
              </div>
              <div style={{ fontSize: "12px", color: "var(--warning)" }}>
                {failureCount} retries recorded
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Working Memory */}
      <div
        className="memory-tier working"
        style={{
          background: "var(--bg-elevated)",
          borderRadius: "6px",
          padding: "12px",
        }}
      >
        <div
          style={{
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "12px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            paddingBottom: "6px",
          }}
        >
          <span className="memory-tier-dot" style={{ background: "#a855f7" }} />
          <span>Working Memory</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              Active Files
            </div>
            {activeFiles.length === 0 ? (
              <div style={{ fontSize: "12px", color: "var(--fg-muted)" }}>
                None yet
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px",
                  marginTop: "2px",
                }}
              >
                {activeFiles.slice(0, 4).map((f, i) => (
                  <span
                    key={i}
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "10px",
                    }}
                  >
                    📄{" "}
                    {typeof f === "string"
                      ? f.split(/[/\\]/).pop()
                      : JSON.stringify(f)}
                  </span>
                ))}
                {activeFiles.length > 4 && (
                  <span
                    style={{
                      fontSize: "10px",
                      color: "var(--fg-muted)",
                      alignSelf: "center",
                    }}
                  >
                    +{activeFiles.length - 4} more
                  </span>
                )}
              </div>
            )}
          </div>
          {taskMemory.completed && taskMemory.completed.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--fg-muted)",
                  textTransform: "uppercase",
                  marginBottom: "2px",
                }}
              >
                Completed Tasks
              </div>
              <div style={{ fontSize: "11px", color: "var(--success)" }}>
                {taskMemory.completed.slice(-2).map((t, i) => (
                  <div key={i}>✓ {t}</div>
                ))}
              </div>
            </div>
          )}
          {taskMemory.pending && taskMemory.pending.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--fg-muted)",
                  textTransform: "uppercase",
                  marginBottom: "2px",
                }}
              >
                Pending Tasks
              </div>
              <div style={{ fontSize: "11px", color: "var(--fg-muted)" }}>
                {taskMemory.pending.slice(0, 2).map((t, i) => (
                  <div key={i}>□ {t}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Long-Term Memory */}
      <div
        className="memory-tier long-term"
        style={{
          background: "var(--bg-elevated)",
          borderRadius: "6px",
          padding: "12px",
        }}
      >
        <div
          style={{
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "12px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            paddingBottom: "6px",
          }}
        >
          <span className="memory-tier-dot" style={{ background: "#22c55e" }} />
          <span>Project Knowledge</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              Project Architecture
            </div>
            <div
              style={{
                fontSize: "12px",
                display: "flex",
                flexWrap: "wrap",
                gap: "4px",
              }}
            >
              {session?.projectKnowledge ? (
                <>
                  <span
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                    }}
                  >
                    {session.projectKnowledge.language}
                  </span>
                  {session.projectKnowledge.framework !== "Unknown" && (
                    <span
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      {session.projectKnowledge.framework}
                    </span>
                  )}
                  {session.projectKnowledge.database !== "Unknown" && (
                    <span
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      {session.projectKnowledge.database}
                    </span>
                  )}
                </>
              ) : (
                <span>workspace/ (Discovered)</span>
              )}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              User Profile
            </div>
            <div style={{ fontSize: "12px" }}>
              {session?.userProfile?.name && (
                <div style={{ marginBottom: "4px" }}>
                  <strong>Name:</strong> {session.userProfile.name}
                </div>
              )}
              {session?.userProfile?.preferences &&
                session.userProfile.preferences.length > 0 && (
                  <div>
                    <strong>Preferences:</strong>
                    <ul
                      style={{
                        margin: "4px 0 0 0",
                        paddingLeft: "16px",
                        color: "var(--fg-muted)",
                      }}
                    >
                      {session.userProfile.preferences.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {session?.userProfile?.facts &&
                session.userProfile.facts.length > 0 && (
                  <div style={{ marginTop: "4px" }}>
                    <strong>Facts:</strong>
                    <ul
                      style={{
                        margin: "4px 0 0 0",
                        paddingLeft: "16px",
                        color: "var(--fg-muted)",
                      }}
                    >
                      {session.userProfile.facts.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {!session?.userProfile?.name &&
                (!session?.userProfile?.preferences ||
                  session.userProfile.preferences.length === 0) &&
                (!session?.userProfile?.facts ||
                  session.userProfile.facts.length === 0) && (
                  <span style={{ color: "var(--fg-muted)" }}>
                    No personal facts extracted yet.
                  </span>
                )}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: "10px",
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              Session Lifetime
            </div>
            <div style={{ fontSize: "12px" }}>
              {sessionAge < 60
                ? `${sessionAge} minutes active`
                : `${Math.floor(sessionAge / 60)}h ${sessionAge % 60}m active`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
