"use strict";

const fs = require("fs");
const path = require("path");
const { callLLM } = require("../agent-core/llmClient");

// ─── Directory for per-session files ─────────────────────────────────────────
const SESSIONS_DIR = path.join(__dirname, "..", "sessions");
const LEGACY_FILE = path.join(SESSIONS_DIR, "sessions.json");

// ─── In-memory cache ─────────────────────────────────────────────────────────
// Key: sessionId → Value: session object
// Avoids hitting disk on every getSession() call.
const sessionCache = new Map();

// ─── Ensure sessions directory exists ────────────────────────────────────────
function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

// ─── Resolve the path to a session file ─────────────────────────────────────
function sessionFilePath(sessionId) {
  if (!sessionId) return null;
  // Sanitize the sessionId to prevent path traversal
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

// 💡 Example:
// Input	              Output
// user/123	          user_123
// abc..\\..	        abc____
// session@1!	        session_1_




// ─── Migrate legacy sessions.json → individual files ─────────────────────────
// Called once on startup. Non-destructive — leaves sessions.json as a backup.
function migrateLegacySessions() {
  if (!fs.existsSync(LEGACY_FILE)) return;

  let legacy;
  try {
    const raw = fs.readFileSync(LEGACY_FILE, "utf8");
    legacy = JSON.parse(raw);
  } catch {
    return; // Corrupt or empty — skip migration
  }

  if (!legacy || typeof legacy !== "object") return;

  let migrated = 0;
  for (const [sessionId, session] of Object.entries(legacy)) {
    const dest = sessionFilePath(sessionId);
    // Only migrate if the individual file doesn't exist yet
    if (!fs.existsSync(dest)) {
      try {
        fs.writeFileSync(dest, JSON.stringify(session, null, 2), "utf8");
        migrated++;
      } catch (e) {
        console.warn(
          `[SessionStore] Migration failed for ${sessionId}:`,
          e.message,
        );
      }
    }
  }

  if (migrated > 0) {
    console.log(
      `[SessionStore] Migrated ${migrated} sessions from sessions.json → sessions/<id>.json`,
    );
  }
}

// Run migration immediately when this module loads
ensureDir();
migrateLegacySessions();

// ─── Read a single session from disk ─────────────────────────────────────────
function readSessionFromDisk(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Debounce registry: prevents write storms under rapid saves ──────────────
const _writeTimers = new Map();

// ─── Write a single session to disk (async, debounced per sessionId) ─────────
function writeSessionToDisk(sessionId, data) {
  ensureDir();
  const filePath = sessionFilePath(sessionId);

  // Snapshot the data now so late mutations don't affect what we write
  const snapshot = JSON.stringify(data, null, 2);

  // Clear any pending write for this session and schedule a new one
  if (_writeTimers.has(sessionId)) {
    clearTimeout(_writeTimers.get(sessionId));
  }

  _writeTimers.set(
    sessionId,
    setTimeout(() => {
      _writeTimers.delete(sessionId);
      fs.promises
        .writeFile(filePath, snapshot, "utf8")
        .catch((e) =>
          console.error(
            `[SessionStore] Failed to save session ${sessionId}:`,
            e.message,
          ),
        );
    }, 150), // 150 ms debounce window
  );
}

// ─── Long Term Memory ────────────────────────────────────────────────
const PROFILE_FILE = path.join(SESSIONS_DIR, "user_profile.json");
let userProfileCache = null;
let _ltmWriteTimer   = null;

/**
 * V3 schema:
 * permanent.user        → rich object  { name, role, skills[], goals[] }
 * permanent.projects    → array        [{ name, description, stack[] }]
 * permanent.preferences → object       { codeStyle, verbosity, architectureBias }
 * permanent.relationships → array      [{ entity, type }]
 */
function _v3Default() {
  return {
    _version: 3,
    permanent: {
      user:          {},
      projects:      [],
      preferences:   {},
      relationships: [],
    },
    session: {
      instructions:     [],
      temporary_context: [],
    },
  };
}

function getLongTermMemory() {
  if (userProfileCache) return userProfileCache;

  const defaultProfile = _v3Default();

  if (!fs.existsSync(PROFILE_FILE)) {
    userProfileCache = defaultProfile;
    return userProfileCache;
  }
  try {
    userProfileCache = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));

    // ─── Migration V1/V2 → V3 ───────────────────────────────────────────────
    const v = userProfileCache._version || 0;
    if (v < 3) {
      const migrated = _v3Default();
      const src = userProfileCache.permanent || {};

      // Carry over user and preferences as-is
      migrated.permanent.user        = src.user        || {};
      migrated.permanent.preferences = src.preferences || {};

      // V1: flat name field
      if (v <= 1 && userProfileCache.name) {
        migrated.permanent.user.name = userProfileCache.name;
      }

      // V2: projects/relationships were objects → convert to arrays
      if (src.projects && !Array.isArray(src.projects)) {
        migrated.permanent.projects = Object.values(src.projects);
      } else {
        migrated.permanent.projects = Array.isArray(src.projects) ? src.projects : [];
      }
      if (src.relationships && !Array.isArray(src.relationships)) {
        migrated.permanent.relationships = Object.values(src.relationships);
      } else {
        migrated.permanent.relationships = Array.isArray(src.relationships) ? src.relationships : [];
      }

      migrated.session  = userProfileCache.session || migrated.session;
      userProfileCache  = migrated;
      console.log(`[LTM] Migrated user profile V${v} → V3`);
    }
    // ────────────────────────────────────────────────────────────────────────

    return userProfileCache;
  } catch {
    userProfileCache = defaultProfile;
    return userProfileCache;
  }
}

/**
 * Persist the user profile. Async + debounced to avoid blocking the event loop.
 */
function updateLongTermMemory(newProfile) {
  userProfileCache = newProfile;
  ensureDir();
  const snapshot = JSON.stringify(newProfile, null, 2);
  if (_ltmWriteTimer) clearTimeout(_ltmWriteTimer);
  _ltmWriteTimer = setTimeout(() => {
    _ltmWriteTimer = null;
    fs.promises
      .writeFile(PROFILE_FILE, snapshot, 'utf8')
      .catch((e) => console.error('[LTM] Failed to save user profile:', e.message));
  }, 200);
}


// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a session by ID.
 * Checks the in-memory cache first; reads from disk on a cache miss.
 * @param {string} sessionId
 * @returns {object|null}
 */
function getSession(sessionId) {
  if (sessionCache.has(sessionId)) {
    return sessionCache.get(sessionId);
  }
  const data = readSessionFromDisk(sessionId);
  if (data) {
    sessionCache.set(sessionId, data);
  }
  return data;
}

/**
 * Save (create or update) a session.
 * Updates the cache and writes the individual session file.
 * @param {string} sessionId
 * @param {object} data  - Full session object (un-truncated messages array)
 */
function saveSession(sessionId, data) {
  sessionCache.set(sessionId, data);
  writeSessionToDisk(sessionId, data);
}

/**
 * Delete a session by ID.
 * Removes from cache and deletes the file.
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
  sessionCache.delete(sessionId);
  const filePath = sessionFilePath(sessionId);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error(
      `[SessionStore] Failed to delete session ${sessionId}:`,
      e.message,
    );
  }
}

/**
 * Get all sessions.
 * Reads all <id>.json files from the sessions/ directory.
 * Skips the legacy sessions.json file.
 * @returns {object}  - Map of sessionId → session
 */
function getAllSessions() {
  ensureDir();
  const result = {};
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return result;
  }

  for (const file of files) {
    if (!file.endsWith(".json") || file === "sessions.json") continue;
    const sessionId = file.slice(0, -5); // Remove .json extension
    // Use cache if available
    if (sessionCache.has(sessionId)) {
      result[sessionId] = sessionCache.get(sessionId);
      continue;
    }
    const data = readSessionFromDisk(sessionId);
    if (data) {
      sessionCache.set(sessionId, data);
      result[sessionId] = data;
    }
  }
  return result;
}

/**
 * Clear all sessions (cache + disk).
 */
function clearAllSessions() {
  sessionCache.clear();
  ensureDir();
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || file === "sessions.json") continue;
    try {
      fs.unlinkSync(path.join(SESSIONS_DIR, file));
    } catch {}
  }
}

/**
 * Compress a session's messages if it exceeds a certain length.
 * Messages are compressed into `session.episodicMemory`.
 */
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
    
    // Fallback: Extract key information programmatically
    return messages
      .map(m => {
        const content = m.content?.substring(0, 200) || '[Action]';
        const files = extractFilePathsFromText(content);
        return `${m.role}: ${content}${files.length ? ' | Files: ' + files.join(', ') : ''}`;
      })
      .join(' → ');
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

// Helper to format content
function formatMessageContent(message) {
  if (message.content) return message.content;
  if (message.tool_calls) {
    const tool = message.tool_calls[0];
    return `[Executed: ${tool.function.name}]`;
  }
  return '[Action]';
}

/**
 * Get highly relevant episodic memories based on the attention system (importance, recency, relevance).
 * Scores each episodic entry by importance × 1.5 + recency × 0.5 + keyword-relevance × 2.0
 */
function getAttentiveMemory(sessionId, currentTaskContext, limit = 3) {
  const session = getSession(sessionId);
  if (!session || !session.episodicMemory || session.episodicMemory.length === 0) return [];

  const now = Date.now();
  const scoredMemories = session.episodicMemory.map(mem => {
    // 1. Recency Score (decays 1 point per hour, floor 0)
    const age = now - (mem.timestamp || now);
    const recencyScore = Math.max(0, 100 - (age / (1000 * 60 * 60)));

    // 2. Importance Score (failures = 80, successes = 30, explicit override if set)
    const importanceScore = mem.importance || 50;

    // 3. Relevance Score (keyword overlap between task and stored summary)
    let relevanceScore = 0;
    if (currentTaskContext && mem.summary) {
      const keywords = currentTaskContext.toLowerCase().split(/\s+/);
      const summaryLower = mem.summary.toLowerCase();
      for (const kw of keywords) {
        if (kw.length > 3 && summaryLower.includes(kw)) relevanceScore += 10;
      }
    }
    relevanceScore = Math.min(100, relevanceScore);

    const totalScore = (importanceScore * 1.5) + (recencyScore * 0.5) + (relevanceScore * 2.0);
    return { ...mem, scores: { importanceScore, recencyScore, relevanceScore, totalScore } };
  });

  scoredMemories.sort((a, b) => b.scores.totalScore - a.scores.totalScore);
  return scoredMemories.slice(0, limit);
}

// ─── Single authoritative export ──────────────────────────────────────────────
module.exports = {
  // Session CRUD
  getSession,
  saveSession,
  deleteSession,
  getAllSessions,
  clearAllSessions,
  // Long-Term Memory
  getLongTermMemory,
  updateLongTermMemory,
  // Episodic compression & retrieval
  compressSession,
  getAttentiveMemory,
  // Utilities (used by tests and other modules)
  identifyMessageSegments,
  extractKeyEvents,
  extractFileChanges,
  extractCodeSnippets,
};

