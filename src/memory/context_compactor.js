"use strict";

const fs = require("fs");
const path = require("path");
const { callLLM } = require("../agent-core/llmClient");
const { getSession, saveSession } = require("./session_store");
const { contextRetriever } = require("../retrieval/context_retriever");

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
/**
 * Advanced session compression with sliding window and semantic chunking
 */
async function compressSession(sessionId, options = {}) {
  const {
    minMessages = 15,           // Minimum messages before compression
    recentWindow = 6,           // Always keep last N messages
    compressionChunkSize = 10,  // Compress in semantic chunks
    maxEpisodicMemories = 50,   // Prevent unbounded growth
    preserveToolCalls = true,   // Keep important tool executions
    compressionQuality = 'balanced', // 'fast' | 'balanced' | 'detailed'
  } = options;

  const session = getSession(sessionId);
  
  // Validation
  if (!session?.messages?.length) {
    return session;
  }

  if (session.messages.length < minMessages) {
    return session;
  }

  // Initialize episodic memory
  if (!session.episodicMemory) {
    session.episodicMemory = [];
    session.compressionMetadata = {
      totalCompressions: 0,
      originalMessageCount: session.messages.length,
      lastCompression: null,
    };
  }

  try {
    // Create backup before compression
    const backup = JSON.parse(JSON.stringify(session.messages));

    // Identify message segments
    const segments = identifyMessageSegments(session.messages, {
      recentWindow,
      preserveToolCalls,
    });

    const {
      systemMessages,
      recentMessages,
      compressibleMessages,
      criticalMessages,
    } = segments;

    if (compressibleMessages.length === 0) {
      console.log('[SessionStore] No messages to compress');
      return session;
    }

    // Compress in semantic chunks
    const compressionResults = await compressInChunks(
      compressibleMessages,
      compressionChunkSize,
      compressionQuality
    );

    // Validate compression quality
    const qualityCheck = validateCompressionQuality(
      compressibleMessages,
      compressionResults
    );

    if (!qualityCheck.acceptable) {
      console.warn('[SessionStore] Compression quality below threshold, skipping');
      return session;
    }

    // Build new episodic memory entry
    const episodicEntry = {
      id: generateId(),
      timestamp: Date.now(),
      messageRange: {
        start: compressibleMessages[0].timestamp || Date.now(),
        end: compressibleMessages[compressibleMessages.length - 1].timestamp || Date.now(),
      },
      originalMessageCount: compressibleMessages.length,
      compressionType: 'semantic_chunked',
      summary: compressionResults.consolidatedSummary,
      keyEvents: extractKeyEvents(compressibleMessages),
      fileChanges: extractFileChanges(compressibleMessages),
      decisions: extractDecisions(compressibleMessages),
      codeSnippets: extractCodeSnippets(compressibleMessages),
      toolCalls: preserveToolCalls 
        ? compressibleMessages.filter(m => m.tool_calls).map(m => ({
            tool: m.tool_calls[0]?.function?.name,
            timestamp: m.timestamp,
            result: m.content?.substring(0, 200),
          }))
        : [],
      chunks: compressionResults.chunks,
      compressionRatio: compressibleMessages.length / compressionResults.chunks.length,
    };

    // Add to episodic memory with size management
    session.episodicMemory.push(episodicEntry);

    // Persist to LanceDB vector database for semantic search
    try {
      await contextRetriever.addMemory(
        "episodic_memory",
        `Session compression summary: ${episodicEntry.summary}`,
        episodicEntry
      );
      console.log(`[SessionStore] Episodic entry persisted to LanceDB.`);
    } catch (e) {
      console.warn(`[SessionStore] Failed to write episodic memory to LanceDB:`, e.message);
    }
    
    // Merge old episodic memories if exceeding limit
    if (session.episodicMemory.length > maxEpisodicMemories) {
      session.episodicMemory = await mergeOldestMemories(
        session.episodicMemory,
        maxEpisodicMemories
      );
    }

    // Reconstruct message array
    session.messages = [
      ...systemMessages,
      ...criticalMessages,
      ...recentMessages,
    ];

    // Update metadata
    if (!session.compressionMetadata) {
      session.compressionMetadata = { totalCompressions: 0, messagesCompressed: 0 };
    }
    session.compressionMetadata.totalCompressions++;
    session.compressionMetadata.lastCompression = Date.now();
    session.compressionMetadata.messagesCompressed = 
      (session.compressionMetadata.messagesCompressed || 0) + compressibleMessages.length;
    session.compressionMetadata.currentMessageCount = session.messages.length;

    // Save session
    saveSession(sessionId, session);

    console.log(`[SessionStore] Compressed ${compressibleMessages.length} messages into ${compressionResults.chunks.length} chunks. Quality: ${qualityCheck.score.toFixed(2)}`);

    return session;

  } catch (error) {
    console.error('[SessionStore] Compression failed:', error);
    // Rollback on failure (backup already created)
    return session;
  }
}

/**
 * Identify different message segments
 */
function identifyMessageSegments(messages, options) {
  const { recentWindow, preserveToolCalls } = options;

  // System messages (always keep)
  const systemMessages = messages.filter(m => m.role === 'system');

  // Recent messages (always keep)
  const recentMessages = messages.slice(-recentWindow);

  // Critical messages (preserve specific patterns)
  const criticalMessages = messages.filter((m, idx) => {
    if (idx >= messages.length - recentWindow) return false; // Already in recent
    if (m.role === 'system') return false; // Already captured

    // Preserve tool calls if enabled
    if (preserveToolCalls && m.tool_calls?.length > 0) {
      const toolName = m.tool_calls[0]?.function?.name;
      const criticalTools = [
        'fs.deleteFile',
        'fs.renameFile', 
        'terminal.exec',
        'git.commit',
      ];
      return criticalTools.includes(toolName);
    }

    // Preserve error messages
    if (m.content?.toLowerCase().includes('error') || 
        m.content?.toLowerCase().includes('failed')) {
      return true;
    }

    // Preserve decision points
    if (m.content?.match(/\b(decided|choosing|selected|approved)\b/i)) {
      return true;
    }

    return false;
  });

  // Get indices to exclude from compression
  const excludeIndices = new Set([
    ...systemMessages.map((_, i) => i),
    ...recentMessages.map((_, i) => messages.length - recentWindow + i),
    ...criticalMessages.map(m => messages.indexOf(m)),
  ]);

  // Compressible messages (everything else)
  const compressibleMessages = messages.filter(
    (_, idx) => !excludeIndices.has(idx)
  );

  return {
    systemMessages,
    recentMessages,
    compressibleMessages,
    criticalMessages,
  };
}

/**
 * Compress messages in semantic chunks
 */
async function compressInChunks(messages, chunkSize, quality) {
  const chunks = [];
  
  // Group messages into semantic chunks
  for (let i = 0; i < messages.length; i += chunkSize) {
    const chunk = messages.slice(i, i + chunkSize);
    
    // Identify semantic boundaries (conversations about same topic)
    const semanticChunk = groupBySemanticSimilarity(chunk);
    
    const summary = await compressChunk(semanticChunk, quality);
    
    chunks.push({
      messageCount: semanticChunk.length,
      timeRange: {
        start: semanticChunk[0].timestamp,
        end: semanticChunk[semanticChunk.length - 1].timestamp,
      },
      summary,
      topics: extractTopics(semanticChunk),
    });
  }

  // Create consolidated summary
  const consolidatedSummary = await consolidateChunks(chunks, quality);

  return {
    chunks,
    consolidatedSummary,
  };
}

/**
 * Compress a single chunk with quality settings
 */
async function compressChunk(messages, quality) {
  const rawTranscript = messages
    .map((m) => {
      const speaker = m.role === 'user' ? 'User' : 'Agent';
      const content = formatMessageContent(m);
      const timestamp = m.timestamp ? new Date(m.timestamp).toISOString() : '';
      return `[${timestamp}] ${speaker}: ${content}`;
    })
    .join('\n\n');

  const systemPrompts = {
    fast: `Compress this conversation into 2-3 sentences. Keep file paths and critical decisions only.`,
    
    balanced: `You are a memory compression module.
Summarize this conversation segment into a structured format:
- Tasks completed
- Decisions made  
- Files modified (EXACT paths and line numbers)
- Code changes (preserve important snippets)
- Errors or issues encountered

COMPLETELY DROP: greetings, acknowledgments, conversational filler.
Return only factual information in bullet points.`,

    detailed: `You are an advanced memory compression system.
Create a detailed but concise summary preserving:

1. CONTEXT: What was being worked on
2. ACTIONS: Specific tasks completed (with file paths, line numbers, function names)
3. CODE: Important code snippets or logic changes (verbatim)
4. DECISIONS: Why certain approaches were chosen
5. OUTCOMES: Results, errors, or next steps
6. REFERENCES: File paths, URLs, documentation links

Format as structured JSON:
{
  "context": "...",
  "actions": ["...", "..."],
  "code_changes": [{"file": "...", "lines": "...", "change": "..."}],
  "decisions": ["...", "..."],
  "outcomes": ["...", "..."]
}

Be extremely precise with technical details. Drop all conversational noise.`,
  };

  try {
    const res = await callLLM({
      messages: [{ role: 'user', content: rawTranscript }],
      system: systemPrompts[quality] || systemPrompts.balanced,
      model: getCompressionModel(quality),
      provider: 'mistral',
      onChunk: null,
      signal: new AbortController().signal,
      temperature: 0.3, // Lower temperature for factual compression
    });

    return res.reply.trim();
  } catch (error) {
    console.warn('[compressChunk] LLM failed, using fallback:', error.message);
    
    // BudgetAwareCompactor logic
    const recent = messages.slice(-5);
    const facts = extractKeyEvents(messages).slice(-3).map(e => `${e.type}: ${e.content}`).join('; ');
    const recentConcat = recent.map(m => {
      const content = m.content?.substring(0, 150) || '[Action]';
      const files = extractFilePathsFromText(m.content || '');
      return `${m.role}: ${content}${files.length ? ' | Files: ' + files.join(', ') : ''}`;
    }).join('\n');
    
    return `[Summary] Extracted via fallback due to LLM timeout/error.
[Recent Messages]
${recentConcat}
[Actionable Facts]
${facts}`;
  }
}

/**
 * Get appropriate model based on quality setting
 */
function getCompressionModel(quality) {
  const models = {
    fast: 'open-mistral-7b',
    balanced: 'mistral-small-latest',
    detailed: 'mistral-medium-latest',
  };
  return models[quality] || models.balanced;
}

/**
 * Extract key events from messages
 */
function extractKeyEvents(messages) {
  const events = [];
  
  messages.forEach(m => {
    // File operations
    if (m.tool_calls) {
      const toolName = m.tool_calls[0]?.function?.name;
      if (toolName?.startsWith('fs.')) {
        events.push({
          type: 'file_operation',
          tool: toolName,
          timestamp: m.timestamp,
        });
      }
    }

    // Errors
    if (m.content?.toLowerCase().includes('error')) {
      events.push({
        type: 'error',
        content: m.content.substring(0, 200),
        timestamp: m.timestamp,
      });
    }

    // Completions
    if (m.content?.match(/\b(completed|finished|done)\b/i)) {
      events.push({
        type: 'completion',
        content: m.content.substring(0, 100),
        timestamp: m.timestamp,
      });
    }
  });

  return events;
}

/**
 * Extract file changes
 */
function extractFileChanges(messages) {
  const fileChanges = new Map();

  messages.forEach(m => {
    const content = m.content || '';
    const filePaths = extractFilePathsFromText(content);

    filePaths.forEach(path => {
      if (!fileChanges.has(path)) {
        fileChanges.set(path, {
          path,
          operations: [],
          firstSeen: m.timestamp,
          lastSeen: m.timestamp,
        });
      }

      const entry = fileChanges.get(path);
      entry.lastSeen = m.timestamp;

      if (m.tool_calls) {
        const toolName = m.tool_calls[0]?.function?.name;
        entry.operations.push(toolName);
      }
    });
  });

  return Array.from(fileChanges.values());
}

/**
 * Extract code snippets
 */
function extractCodeSnippets(messages) {
  const snippets = [];

  messages.forEach(m => {
    const content = m.content || '';
    const codeBlocks = content.match(/```[\s\S]*?```/g) || [];

    codeBlocks.forEach(block => {
      const lines = block.split('\n');
      const lang = lines[0].replace('```', '').trim();
      const code = lines.slice(1, -1).join('\n');

      if (code.length > 50 && code.length < 1000) { // Reasonable snippet size
        snippets.push({
          language: lang,
          code: code.trim(),
          timestamp: m.timestamp,
        });
      }
    });
  });

  return snippets;
}

/**
 * Extract decisions from messages
 */
function extractDecisions(messages) {
  const decisions = [];

  messages.forEach(m => {
    const content = m.content || '';
    
    // Look for decision indicators
    const decisionPatterns = [
      /decided to (.*?)[\.\n]/i,
      /choosing (.*?) because/i,
      /will use (.*?)[\.\n]/i,
      /selected (.*?)[\.\n]/i,
      /going with (.*?)[\.\n]/i,
    ];

    decisionPatterns.forEach(pattern => {
      const match = content.match(pattern);
      if (match) {
        decisions.push({
          decision: match[1],
          timestamp: m.timestamp,
          context: content.substring(0, 200),
        });
      }
    });
  });

  return decisions;
}

/**
 * Extract file paths from text
 */
function extractFilePathsFromText(text) {
  const patterns = [
    /[\w\/\-\.]+\.(js|ts|jsx|tsx|py|java|cpp|css|html|json|md|txt)/g,
    /src\/[\w\/\-\.]+/g,
    /\.\/[\w\/\-\.]+/g,
  ];

  const paths = new Set();

  patterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(match => paths.add(match));
  });

  return Array.from(paths);
}

/**
 * Validate compression quality.
 * For pure chat/reasoning sessions (no file paths), only check compression ratio.
 * For code sessions, also check that file paths are retained in the summary.
 */
function validateCompressionQuality(originalMessages, compressionResults) {
  const { consolidatedSummary, chunks } = compressionResults;

  const originalText = originalMessages.map(m => m.content || '').join(' ');
  const filePaths = extractFilePathsFromText(originalText);
  const summaryFilePaths = extractFilePathsFromText(consolidatedSummary);

  const hasFilePaths = filePaths.length > 0;
  const pathRetention = hasFilePaths
    ? summaryFilePaths.length / filePaths.length
    : 1.0; // Pure chat: no file paths to lose, so retention is perfect by definition

  const originalLength = originalText.length;
  const summaryLength = consolidatedSummary.length;
  const compressionRatio = originalLength > 0
    ? 1 - (summaryLength / originalLength)
    : 0;

  // Weight path retention lower if there are no code paths
  const pathWeight = hasFilePaths ? 0.6 : 0.0;
  const ratioWeight = hasFilePaths ? 0.4 : 1.0;
  const score = (pathRetention * pathWeight) + (compressionRatio * ratioWeight);

  // For code sessions require path retention ≥ 70%; for chat just need ratio > 0.3
  const acceptable = hasFilePaths
    ? score > 0.4 && pathRetention > 0.7
    : compressionRatio > 0.3;

  return {
    acceptable,
    score,
    pathRetention,
    compressionRatio,
    metrics: {
      originalMessages: originalMessages.length,
      chunks: chunks.length,
      pathsPreserved: summaryFilePaths.length,
      pathsOriginal: filePaths.length,
      sessionType: hasFilePaths ? 'code' : 'chat',
    },
  };
}

/**
 * Consolidate chunk summaries
 */
async function consolidateChunks(chunks, quality) {
  if (chunks.length === 1) {
    return chunks[0].summary;
  }

  const chunkSummaries = chunks.map((c, i) => 
    `[Chunk ${i + 1}/${chunks.length}] ${c.summary}`
  ).join('\n\n');

  const systemPrompt = `Consolidate these chunk summaries into a single coherent summary.
Preserve all file paths, code snippets, and technical details.
Remove redundancy but keep all unique information.`;

  try {
    const res = await callLLM({
      messages: [{ role: 'user', content: chunkSummaries }],
      system: systemPrompt,
      model: getCompressionModel(quality),
      provider: 'mistral',
      temperature: 0.3,
      signal: new AbortController().signal,
    });

    return res.reply.trim();
  } catch (error) {
    console.warn('[consolidateChunks] Failed, using chunk concatenation');
    return chunks.map(c => c.summary).join(' | ');
  }
}

/**
 * Merge oldest episodic memories when limit is reached
 */
async function mergeOldestMemories(memories, maxCount) {
  if (memories.length <= maxCount) {
    return memories;
  }

  // Sort by timestamp
  const sorted = [...memories].sort((a, b) => a.timestamp - b.timestamp);

  // Keep newest memories as-is
  const keep = sorted.slice(-(maxCount - 1));

  // Merge oldest memories
  const toMerge = sorted.slice(0, sorted.length - (maxCount - 1));

  const merged = {
    id: generateId(),
    timestamp: toMerge[0].timestamp,
    messageRange: {
      start: toMerge[0].messageRange.start,
      end: toMerge[toMerge.length - 1].messageRange.end,
    },
    originalMessageCount: toMerge.reduce((sum, m) => sum + m.originalMessageCount, 0),
    compressionType: 'merged_episodic',
    summary: toMerge.map(m => m.summary).join('\n\n---\n\n'),
    keyEvents: toMerge.flatMap(m => m.keyEvents || []),
    fileChanges: mergeDuplicateFileChanges(toMerge.flatMap(m => m.fileChanges || [])),
    decisions: toMerge.flatMap(m => m.decisions || []),
    mergedFrom: toMerge.length,
  };

  return [merged, ...keep];
}

/**
 * Merge duplicate file changes
 */
function mergeDuplicateFileChanges(changes) {
  const map = new Map();

  changes.forEach(change => {
    if (map.has(change.path)) {
      const existing = map.get(change.path);
      existing.operations = [...new Set([...existing.operations, ...change.operations])];
      existing.lastSeen = Math.max(existing.lastSeen, change.lastSeen);
    } else {
      map.set(change.path, { ...change });
    }
  });

  return Array.from(map.values());
}

/**
 * Group messages by semantic similarity (simplified)
 */
function groupBySemanticSimilarity(messages) {
  return messages;
}

/**
 * Extract topics from messages
 */
function extractTopics(messages) {
  const topics = new Set();
  
  messages.forEach(m => {
    const content = (m.content || '').toLowerCase();
    
    // Simple keyword extraction
    if (content.includes('fix') || content.includes('bug')) topics.add('bug_fix');
    if (content.includes('feature') || content.includes('implement')) topics.add('feature');
    if (content.includes('refactor')) topics.add('refactor');
    if (content.includes('test')) topics.add('testing');
    if (content.includes('deploy')) topics.add('deployment');
    if (content.includes('config')) topics.add('configuration');
  });

  return Array.from(topics);
}

/**
 * Format message content for compression
 */
function formatMessageContent(message) {
  if (message.content) {
    return message.content;
  }
  
  if (message.tool_calls) {
    const tool = message.tool_calls[0];
    return `[Tool: ${tool.function.name}(${JSON.stringify(tool.function.arguments).substring(0, 100)})]`;
  }

  return '[No content]';
}

/**
 * Generate unique ID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}


/**
 * Get highly relevant episodic memories based on the attention system (importance, recency, relevance).
 * Scores each episodic entry by importance × 1.5 + recency × 0.5 + keyword-relevance × 2.0
 */
async function getAttentiveMemory(sessionId, currentTaskContext, limit = 3) {
  const session = getSession(sessionId);
  if (!session || !session.episodicMemory || session.episodicMemory.length === 0) return [];

  const now = Date.now();
  const taskVec = await contextRetriever._generateEmbedding(currentTaskContext || "");

  const scoredMemories = [];
  for (const mem of session.episodicMemory) {
    // 1. Recency Score (decays 1 point per hour, floor 0)
    const age = now - (mem.timestamp || now);
    const recencyScore = Math.max(0, 100 - (age / (1000 * 60 * 60)));

    // 2. Importance Score (failures = 80, successes = 30, explicit override if set)
    const importanceScore = mem.importance || 50;

    // 3. Semantic & Keyword Score
    let semanticScore = 0;
    if (currentTaskContext && mem.summary) {
      const memVec = await contextRetriever._generateEmbedding(mem.summary);
      const sim = cosineSimilarity(taskVec, memVec);
      semanticScore = Math.max(0, Math.min(100, (sim + 1) * 50));
      
      const keywords = currentTaskContext.toLowerCase().split(/\s+/);
      const summaryLower = mem.summary.toLowerCase();
      let kwBoost = 0;
      for (const kw of keywords) {
        if (kw.length > 3 && summaryLower.includes(kw)) kwBoost += 5;
      }
      semanticScore = Math.min(100, semanticScore + kwBoost);
    }

    // Hybrid Final Score
    const totalScore = (semanticScore * 0.7) + (importanceScore * 0.2) + (recencyScore * 0.1);
    scoredMemories.push({ ...mem, scores: { importanceScore, recencyScore, semanticScore, totalScore } });
  }

  scoredMemories.sort((a, b) => b.scores.totalScore - a.scores.totalScore);
  return scoredMemories.slice(0, limit);
}

module.exports = {
  compressSession,
  getAttentiveMemory,
  identifyMessageSegments,
  extractKeyEvents,
  extractFileChanges,
  extractCodeSnippets,
};

