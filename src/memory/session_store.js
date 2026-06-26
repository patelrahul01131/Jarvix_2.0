"use strict";

/**
 * Session Store — src/memory/session_store.js
 *
 * Manages short-term session memory (chat history, tool execution state, working memory)
 * by persisting each session to an individual JSON file inside `sessions/`.
 */

const fs = require("fs");
const path = require("path");
const { persistenceManager } = require("./PersistenceManager");
const { getWorkspaceRoot } = require("../tools/fileSystem");

function getSessionsDir() {
  const root = getWorkspaceRoot() || process.cwd();
  return path.join(root, ".jarvix", "chats");
}

function getLegacyFile() {
  return path.join(getSessionsDir(), "sessions.json");
}

const sessionCache = new Map();

function ensureDir() {
  const dir = getSessionsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sessionFilePath(sessionId) {
  if (!sessionId) return null;
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(getSessionsDir(), `${safe}.json`);
}

function migrateLegacySessions() {
  const legacyFile = getLegacyFile();
  if (!fs.existsSync(legacyFile)) return;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));
  } catch {
    return;
  }

  if (!legacy || typeof legacy !== "object") return;

  let migrated = 0;
  for (const [sessionId, session] of Object.entries(legacy)) {
    const dest = sessionFilePath(sessionId);
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

function readSessionFromDisk(sessionId) {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeSessionToDisk(sessionId, data) {
  ensureDir();
  const filePath = sessionFilePath(sessionId);
  const snapshot = JSON.stringify(data, null, 2);
  persistenceManager.scheduleWrite(filePath, snapshot, 150);
}

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

function saveSession(sessionId, data) {
  sessionCache.set(sessionId, data);
  writeSessionToDisk(sessionId, data);
}

function deleteSession(sessionId) {
  sessionCache.delete(sessionId);
  const filePath = sessionFilePath(sessionId);
  if (persistenceManager.writeTimers.has(filePath)) {
    clearTimeout(persistenceManager.writeTimers.get(filePath));
    persistenceManager.writeTimers.delete(filePath);
    persistenceManager.pendingWrites.delete(filePath);
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error(
      `[SessionStore] Failed to delete session ${sessionId}:`,
      e.message,
    );
  }
}

function getAllSessions() {
  ensureDir();
  migrateLegacySessions();
  const result = {};
  let files;
  try {
    files = fs.readdirSync(getSessionsDir());
  } catch {
    return result;
  }

  for (const file of files) {
    if (!file.endsWith(".json") || file === "sessions.json") continue;
    const sessionId = file.slice(0, -5);

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

function clearAllSessions() {
  sessionCache.clear();
  ensureDir();
  let files;
  try {
    files = fs.readdirSync(getSessionsDir());
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json") || file === "sessions.json") continue;
    try {
      fs.unlinkSync(path.join(getSessionsDir(), file));
    } catch {}
  }
}

module.exports = {
  getSession,
  saveSession,
  deleteSession,
  getAllSessions,
  clearAllSessions,
};
