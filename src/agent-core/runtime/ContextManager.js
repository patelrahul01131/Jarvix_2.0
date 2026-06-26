// src/agent-core/runtime/ContextManager.js
/**
 * Context Manager
 * Implements separated Read/Write context states, incremental context updates, and token budgeting.
 */

const { RESOURCE_BUDGETS } = require("./Config");

class ContextManager {
  constructor() {
    this.sessionContextCache = new Map(); // sessionId -> cachedContext
  }

  /**
   * Retrieves and formats read context, optimizing with incremental delta caching
   */
  async getReadContext(session, question) {
    const sessionId = session.id;
    let cached = this.sessionContextCache.get(sessionId);

    if (!cached) {
      cached = {
        version: 0,
        historySummary: "",
        lastMessageCount: 0,
        permanentFacts: session.userProfile || {}
      };
    }

    // 1. Calculate delta messages (only process new messages since last compile)
    const messages = session.messages || [];
    const deltaCount = messages.length - cached.lastMessageCount;
    
    if (deltaCount > 0) {
      // Re-summarize conversation history incrementally
      const newMessages = messages.slice(cached.lastMessageCount);
      const newSummaryLines = newMessages
        .filter(m => m.content && typeof m.content === "string")
        .map(m => `${m.role}: ${m.content.slice(0, 100)}`);
      
      cached.historySummary += (cached.historySummary ? "\n" : "") + newSummaryLines.join("\n");
      cached.lastMessageCount = messages.length;
      cached.version += 1;
    }

    // 2. Build Layered Read Context
    const layers = {
      layer1_history: cached.historySummary,
      layer2_memory: JSON.stringify(cached.permanentFacts.permanent || {}),
      layer3_query: question
    };

    // 3. Enforce token budget restrictions on Read Context
    const maxTokens = RESOURCE_BUDGETS.maxContextTokens;
    let formattedText = `History:\n${layers.layer1_history}\n\nFacts:\n${layers.layer2_memory}\n\nQuery:\n${layers.layer3_query}`;
    
    // Naive token approximation (4 characters = 1 token)
    if (formattedText.length / 4 > maxTokens) {
      // Trim history summary first to stay within budget
      const budgetLimitChars = maxTokens * 4;
      const historyCharLimit = Math.max(100, budgetLimitChars - JSON.stringify(layers.layer2_memory).length - question.length - 100);
      layers.layer1_history = layers.layer1_history.slice(-historyCharLimit);
      formattedText = `History (truncated):\n${layers.layer1_history}\n\nFacts:\n${layers.layer2_memory}\n\nQuery:\n${layers.layer3_query}`;
    }

    this.sessionContextCache.set(sessionId, cached);

    return {
      version: cached.version,
      formattedText,
      layers
    };
  }

  /**
   * Captures and stores execution Persistence (Write) Context
   */
  recordWriteContext(session, updates) {
    if (!session.writeContext) {
      session.writeContext = {
        memoryUpdates: [],
        workspaceEdits: [],
        executionNotes: []
      };
    }

    if (updates.memory) {
      session.writeContext.memoryUpdates.push({ ...updates.memory, timestamp: Date.now() });
    }
    if (updates.workspace) {
      session.writeContext.workspaceEdits.push({ ...updates.workspace, timestamp: Date.now() });
    }
    if (updates.notes) {
      session.writeContext.executionNotes.push({ note: updates.notes, timestamp: Date.now() });
    }
  }

  clearSession(sessionId) {
    this.sessionContextCache.delete(sessionId);
  }
}

const contextManagerInstance = new ContextManager();
module.exports = { ContextManager: contextManagerInstance };
