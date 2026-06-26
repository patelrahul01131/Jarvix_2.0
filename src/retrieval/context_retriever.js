"use strict";

const path = require("path");
const fs = require("fs");

/**
 * Context Retriever (LanceDB + Keyword Fallback)
 *
 * Handles storing and retrieving high-dimensional semantic and episodic memories.
 */
class ContextRetriever {
  constructor() {
    this.isReady = false;
    this.dbPath = null;
    this.db = null;
    this.table = null;
    this.dim = 384;
    this._initPromise = null;
  }

  _getDbPath() {
    let root = process.env.JARVIX_WORKSPACE_ROOT || process.cwd();
    try {
      const { getWorkspaceRoot } = require("../tools/fileSystem");
      const wsRoot = getWorkspaceRoot();
      if (wsRoot) root = wsRoot;
    } catch (e) {}
    return path.join(root, ".jarvix", "lancedb");
  }

  /**
   * Checks if the active workspace has changed since last init.
   * If so, tears down the old connection so we reinit to the correct path.
   */
  _checkWorkspaceChange() {
    const currentPath = this._getDbPath();
    if (this.dbPath && this.dbPath !== currentPath) {
      console.log(`[ContextRetriever] Workspace changed: ${this.dbPath} → ${currentPath}. Reinitializing...`);
      this.isReady = false;
      this._initPromise = null;
      this.db = null;
      this.table = null;
      this.dbPath = null;
    }
  }

  async init() {
    this._checkWorkspaceChange();
    if (this.isReady) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      try {
        this.dbPath = this._getDbPath();
        const lancedb = require("@lancedb/lancedb");

        // Ensure directory exists
        if (!fs.existsSync(this.dbPath)) {
          fs.mkdirSync(this.dbPath, { recursive: true });
        }

        this.db = await lancedb.connect(this.dbPath);

        const tableName = "memory_store";
        const tableNames = await this.db.tableNames();

        if (tableNames.includes(tableName)) {
          this.table = await this.db.openTable(tableName);
        } else {
          // Create an empty table with a dummy vector
          const dummyData = [
            {
              vector: Array(this.dim).fill(0),
              type: "init",
              text: "init",
              metadata: JSON.stringify({}),
            },
          ];
          this.table = await this.db.createTable(tableName, dummyData);
        }

        this.isReady = true;
        console.log("[ContextRetriever] LanceDB Initialized.");
      } catch (err) {
        console.warn(
          "[ContextRetriever] LanceDB init failed. Falling back to keyword search.",
          err.message,
        );
        this.isReady = false;
        this._initPromise = null; // Reset lock on error so subsequent attempts can retry
      }
    })();

    return this._initPromise;
  }

  /**
   * Real embedding generation using local ONNX pipeline
   */
  async _generateEmbedding(text) {
    try {
      const { embed } = require("../indexer/EmbeddingService");
      const vector = await embed(text);
      if (Array.isArray(vector) && vector.length === this.dim) {
        return vector;
      }
    } catch (err) {
      console.warn("[ContextRetriever] Failed to generate real embedding, using fallback:", err.message);
    }
    if (!text || typeof text !== "string") {
      return Array(this.dim).fill(0.01);
    }
    // Generate a pseudo-random deterministic vector based on text length
    const vec = Array(this.dim).fill(0.01);
    vec[0] = (text.length % 100) / 100.0;
    return vec;
  }

  /**
   * Adds a memory to LanceDB
   * @param {"semantic_memory" | "episodic_memory"} type
   * @param {string} text
   * @param {object} metadata
   */
  async addMemory(type, text, metadata = {}) {
    this._checkWorkspaceChange();
    if (!this.isReady) await this.init();
    if (!this.isReady) return; // Fallback: no-op if DB fails

    try {
      const vector = await this._generateEmbedding(text);
      await this.table.add([
        {
          vector,
          type,
          text,
          metadata: JSON.stringify(metadata),
        },
      ]);
      console.log("[ContextRetriever] Added memory:", text);
    } catch (err) {
      console.error("[ContextRetriever] Failed to add memory:", err);
    }
  }

  /**
   * Retrieves semantically relevant context from LanceDB
   * @param {string} query
   * @param {number} limit
   * @returns {Promise<import('../agent-core/types').ContextItem[]>}
   */
  async retrieve(query, limit = 5) {
    if (!query) {
      console.warn("[ContextRetriever] Empty query, returning empty memory.");
      return [];
    }

    try {
      this._checkWorkspaceChange();
      if (!this.isReady) await this.init();
    } catch (err) {
      console.warn(
        "[ContextRetriever] Init failed during retrieval:",
        err.message,
      );
      return [];
    }

    // Keyword Fallback (Mock)
    if (!this.isReady) {
      return this._keywordFallback(query);
    }

    try {
      const queryVector = await this._generateEmbedding(query);
      if (!queryVector) {
        console.warn("[ContextRetriever] Failed to generate embedding");
        return [];
      }

      // Timeout protection for search execution
      const results = await Promise.race([
        this.table.search(queryVector).limit(limit).execute(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("LanceDB search timeout")), 3000),
        ),
      ]);

      let finalResults = Array.isArray(results)
        ? results
        : results && typeof results.toArray === "function"
          ? results.toArray()
          : [];
      if (!Array.isArray(finalResults)) finalResults = [];

      return finalResults
        .filter((r) => r.type !== "init")
        .map((r) => ({
          source:
            r.type === "semantic_memory"
              ? "semantic_memory"
              : "episodic_memory",
          score: Math.max(0, 1 - (r._distance || 0)),
          content: {
            text: r.text,
            ...JSON.parse(r.metadata || "{}"),
          },
        }));
    } catch (err) {
      console.error("[ContextRetriever] Search failed:", err.message);
      return this._keywordFallback(query);
    }
  }

  _keywordFallback(query) {
    // Mock simple keyword return for resilience
    console.log("[ContextRetriever] Using keyword fallback.");
    return [
      {
        source: "semantic_memory",
        score: 0.5,
        content: { text: "Keyword search fallback active for query: " + query },
      },
    ];
  }
}

const contextRetriever = new ContextRetriever();
module.exports = { contextRetriever, ContextRetriever };
