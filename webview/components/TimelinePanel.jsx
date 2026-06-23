import { useMemo } from "react";

export default function TimelinePanel({ session }) {
  const events = useMemo(() => {
    const timelineEvents = [];
    if (session?.executionLogs) {
      session.executionLogs.forEach((tool) => {
        if (tool.type === "timeline") {
          timelineEvents.push({
            time: tool.timestamp,
            message: tool.data.message,
            icon: tool.data.message.startsWith("Intent:") ? "🧭" : "💬",
            color: "var(--accent)"
          });
        } else if (tool.type === "plan") {
          timelineEvents.push({
            time: tool.timestamp,
            message: `Tool Execution: ${tool.data.tool}`,
            icon: "⚙️",
            color: "var(--success)"
          });
        }
      });
    }
    return timelineEvents;
  }, [session?.executionLogs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "12px" }}>
      <div style={{ fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: "6px" }}>
        <span style={{ fontSize: '14px' }}>⏱️</span>
        <span>Execution Timeline</span>
      </div>

      {events.length === 0 ? (
        <div style={{ fontSize: "12px", color: "var(--fg-muted)", textAlign: "center", padding: "20px 0" }}>
          No timeline events yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>
          {/* Timeline connecting line */}
          <div style={{ position: "absolute", left: "12px", top: "10px", bottom: "10px", width: "2px", background: "rgba(255,255,255,0.05)" }} />
          
          {events.map((evt, i) => (
            <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
              <div style={{ 
                width: "26px", height: "26px", borderRadius: "50%", background: "var(--bg-elevated)", 
                display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${evt.color}`, fontSize: '12px'
              }}>
                {evt.icon}
              </div>
              <div style={{ display: "flex", flexDirection: "column", paddingTop: "2px" }}>
                <span style={{ fontSize: "10px", color: "var(--fg-muted)" }}>{evt.time}</span>
                <span style={{ fontSize: "12px", color: "var(--fg-primary)", lineHeight: "1.4", wordBreak: "break-word" }}>{evt.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
