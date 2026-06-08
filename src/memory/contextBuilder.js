/**
 * Context Builder
 * Compresses chat history and codebase into optimal working memory.
 */

function buildContext(session, relevantFiles, latestError, currentGoal, workingMemoryState) {
  // Extract last 6 meaningful steps
  const lastSteps = session.messages.slice(-6).map(m => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content.slice(0, 1500) : "[Structured]"
  }));

  // Summarize file tree or file contents
  const fileContext = relevantFiles.map(f => ({
    path: f.path || f.filename,
    type: f.type || "file",
    size: f.size || (f.code ? f.code.length : 0),
    truncated: f.truncated || false,
    missing_parts: f.missing_parts || []
  }));

  return {
    goal: currentGoal || session.goal || "Unknown",
    currentTask: workingMemoryState?.currentTask || "",
    taskHistory: session.taskHistory || [],
    episodicMemory: session.episodicMemory || [],
    lastSteps: lastSteps,
    contextFiles: fileContext,
    latestError: latestError || null
  };
}

module.exports = { buildContext };
