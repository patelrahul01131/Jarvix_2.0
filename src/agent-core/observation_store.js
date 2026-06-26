"use strict";

/**
 * Observation Store
 *
 * Captures and persists structured facts (observations) derived from tool outputs.
 * This ensures the agent "remembers" the exact outcome of grep searches,
 * file reads, and terminal commands without needing to re-read them from
 * raw chat history.
 */

const fs = require("fs");
const path = require("path");

const { getWorkspaceRoot } = require("../tools/fileSystem");

function getObsDir() {
  const root = getWorkspaceRoot() || process.cwd();
  return path.join(root, ".jarvix", "observations");
}

function ensureDir() {
  const dir = getObsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getFilePath(sessionId) {
  if (!sessionId) return null;
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(getObsDir(), `${safe}_obs.json`);
}

function generateId() {
  return (
    "obs_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).substring(2, 6)
  );
}

class ObservationStore {
  constructor() {
    this.cache = new Map();
    this._writeTimers = new Map();
  }

  _readFromDisk(sessionId) {
    const filePath = getFilePath(sessionId);
    if (!fs.existsSync(filePath)) return { observations: [], factIndex: {} };
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return { observations: [], factIndex: {} };
    }
  }

  _writeToDisk(sessionId, data) {
    ensureDir();
    const filePath = getFilePath(sessionId);
    const snapshot = JSON.stringify(data, null, 2);

    if (this._writeTimers.has(sessionId)) {
      clearTimeout(this._writeTimers.get(sessionId));
    }

    this._writeTimers.set(
      sessionId,
      setTimeout(() => {
        this._writeTimers.delete(sessionId);
        fs.promises.writeFile(filePath, snapshot, "utf8").catch((e) => {
          console.error(
            `[ObservationStore] Failed to write for ${sessionId}:`,
            e.message,
          );
        });
      }, 150),
    );
  }

  _getSessionData(sessionId) {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId);
    }
    const data = this._readFromDisk(sessionId);
    this.cache.set(sessionId, data);
    return data;
  }

  record(sessionId, observation) {
    // observation expected schema: { source, tool, fact, value, confidence }
    const data = this._getSessionData(sessionId);

    const obsRecord = {
      ...observation,
      id: generateId(),
      timestamp: Date.now(),
    };

    data.observations.push(obsRecord);

    // Simple deduplication/index by fact string
    if (observation.fact) {
      data.factIndex[observation.fact] = obsRecord;
    }

    this.cache.set(sessionId, data);
    this._writeToDisk(sessionId, data);

    return obsRecord;
  }

  getRelevant(sessionId, query, limit = 5) {
    const data = this._getSessionData(sessionId);
    if (!query) return data.observations.slice(-limit);

    const lowerQuery = String(query).toLowerCase();
    const results = data.observations.filter(
      (o) =>
        (o.fact && o.fact.toLowerCase().includes(lowerQuery)) ||
        (o.tool && o.tool.toLowerCase().includes(lowerQuery)) ||
        (o.value && String(o.value).toLowerCase().includes(lowerQuery)),
    );

    // Return most recent matches
    return results.slice(-limit);
  }

  getRecent(sessionId, limit = 10) {
    const data = this._getSessionData(sessionId);
    return data.observations.slice(-limit);
  }

  getFact(sessionId, factKey) {
    const data = this._getSessionData(sessionId);
    return data.factIndex[factKey] || null;
  }

  clear(sessionId) {
    const data = { observations: [], factIndex: {} };
    this.cache.set(sessionId, data);
    this._writeToDisk(sessionId, data);
  }
}

const observationStore = new ObservationStore();
module.exports = { observationStore };
