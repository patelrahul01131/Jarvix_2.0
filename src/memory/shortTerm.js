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

// ─── Write a single session to disk ──────────────────────────────────────────
function writeSessionToDisk(sessionId, data) {
  ensureDir();
  const filePath = sessionFilePath(sessionId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error(
      `[SessionStore] Failed to save session ${sessionId}:`,
      e.message,
    );
  }
}

// ─── Long Term Memory ────────────────────────────────────────────────────────
const PROFILE_FILE = path.join(SESSIONS_DIR, "user_profile.json");
let userProfileCache = null;

function getLongTermMemory() {
  if (userProfileCache) return userProfileCache;
  if (!fs.existsSync(PROFILE_FILE)) {
    return { name: "", preferences: [], facts: [] };
  }
  try {
    userProfileCache = JSON.parse(fs.readFileSync(PROFILE_FILE, "utf8"));
    if (!userProfileCache.name) userProfileCache.name = "";
    if (!userProfileCache.preferences) userProfileCache.preferences = [];
    if (!userProfileCache.facts) userProfileCache.facts = [];
    return userProfileCache;
  } catch {
    return { name: "", preferences: [], facts: [] };
  }
}

function updateLongTermMemory(newProfile) {
  userProfileCache = newProfile;
  ensureDir();
  try {
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(newProfile, null, 2), "utf8");
  } catch {}
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
async function compressSession(sessionId) {
  const session = getSession(sessionId);
  if (!session || !session.messages || session.messages.length < 15)
    return session;

  if (!session.episodicMemory) {
    session.episodicMemory = [];
  }

  // Keep the first message (initial prompt) and the last 6 messages
  const initialMessage = session.messages[0];
  const recentMessages = session.messages.slice(-6);

  // Compress the middle messages
  const toCompress = session.messages.slice(1, -6);
  if (toCompress.length > 0) {
    const rawTranscript = toCompress
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content || "[Action]"}`)
      .join("\n\n");
      
    const systemPrompt = `You are a memory compression module.
Summarize the following conversation segment into a dense, factual format.
Focus strictly on the core tasks accomplished, decisions made, and codebase edits.
CRITICAL: You MUST retain exact file paths, line numbers, and important code snippets. Do not drop code.
COMPLETELY DROP all greetings, small talk, pleasantries, and conversational filler.
Return only the summary text.`;

    let summaryText = "";
    try {
      const res = await callLLM({
        messages: [{ role: "user", content: rawTranscript }],
        system: systemPrompt,
        model: "open-mistral-7b",
        provider: "mistral",
        onChunk: null,
        signal: new AbortController().signal,
      });
      summaryText = res.reply.trim();
    } catch (e) {
      console.warn("[SessionStore] Failed to summarize session with LLM, falling back to simple snippet.", e.message);
      summaryText = toCompress.map((m) => `${m.role}: ${m.content ? m.content.substring(0, 1000) + "..." : "[Action]"}`).join(" | ");
    }

    session.episodicMemory.push({
      timestamp: Date.now(),
      summary: summaryText,
    });

    // Rewrite the messages array to only keep the head and tail
    session.messages = [initialMessage, ...recentMessages];
    saveSession(sessionId, session);
  }

  return session;
}

/**
 * Get highly relevant episodic memories based on the attention system (importance, recency, relevance).
 */
function getAttentiveMemory(sessionId, currentTaskContext, limit = 3) {
  const session = getSession(sessionId);
  if (!session || !session.episodicMemory) return [];

  const now = Date.now();
  const scoredMemories = session.episodicMemory.map(mem => {
    // 1. Recency Score (decays over hours)
    const age = now - (mem.timestamp || now);
    const recencyScore = Math.max(0, 100 - (age / (1000 * 60 * 60)));

    // 2. Importance Score (default 50 if not specified)
    const importanceScore = mem.importance || 50;

    // 3. Relevance Score (keyword overlap heuristic)
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

module.exports = {
  getSession,
  saveSession,
  deleteSession,
  getAllSessions,
  clearAllSessions,
  getLongTermMemory,
  updateLongTermMemory,
  compressSession,
  getAttentiveMemory
};
