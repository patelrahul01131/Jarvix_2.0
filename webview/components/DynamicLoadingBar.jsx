export default function DynamicLoadingBar({ isLoading, agentStatus }) {
  if (!isLoading) return null;
  
  return (
    <div className="dynamic-loading-bar">
      <div className="loading-glow"></div>
      <div className="loading-content">
        <div className="loading-spinner">
          <div className="spinner-ring"></div>
        </div>
        <span className="loading-text">
          {agentStatus || "Agent is thinking..."}
        </span>
      </div>
    </div>
  );
}
