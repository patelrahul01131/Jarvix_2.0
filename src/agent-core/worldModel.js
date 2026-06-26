'use strict';

/**
 * The Deep World Model
 *
 * Represents the agent's internalized, temporally-aware, and causally-linked
 * understanding of the software environment.
 *
 * Persisted format (session.worldModelData):
 * {
 *   "nodes": {
 *     "shortTerm.js": {
 *       "lastModified": 1719239900000,
 *       "lastTool": "fs.writeFile",
 *       "hash": "af39d2a",
 *       "status": "success",
 *       "confidence": 95
 *     }
 *   },
 *   "edges": [
 *     { "from": "fs.writeFile", "to": "shortTerm.js", "timestamp": 1719239900000, "success": true }
 *   ],
 *   "semanticAbstractions": {},
 *   "causalityGraph": {}
 * }
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class DeepWorldModel {
  constructor() {
    this.semanticAbstractions = {}; // System meaning layer
    this.causalityGraph       = {}; // Dependency graph (A breaks if B changes)
    this.temporalState        = []; // Raw action history
    this.confidenceScores     = {}; // How sure the agent is about a module (0–100)

    // Spec-aligned flat structures (used for serialization & prompt injection)
    this.nodes = {}; // { [moduleId]: { lastModified, lastTool, hash, status, confidence } }
    this.edges = []; // [{ from, to, timestamp, success }]

    // Project-level state architecture
    this.projectState = {
      projectType: null,    // 'nodejs' | 'react' | 'nextjs' | 'python' | ...
      framework: null,      // 'express' | 'fastapi' | ...
      database: null,       // 'sqlite' | 'postgres' | 'mongodb' | ...
      authExists: false,
      testsExist: false,
      buildPassing: null,
      packageManager: null, // 'npm' | 'yarn' | 'pnpm'
      entryPoint: null,     // 'server.js' | 'index.js' | ...
      lastScanned: null,
    };
  }

  // ─── Project Architecture Heuristics ────────────────────────────────────────
  inferProjectState(workspaceRoot) {
    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return;
    
    const pkgJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      this.projectState.projectType = 'nodejs';
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        
        if (deps.express) this.projectState.framework = 'express';
        else if (deps.next) this.projectState.framework = 'nextjs';
        else if (deps.react || deps['react-dom']) this.projectState.framework = 'react';
        
        if (deps.mongoose || deps.mongodb) this.projectState.database = 'mongodb';
        else if (deps.sequelize || deps.pg || deps.sqlite3 || deps.mysql2 || deps.prisma) this.projectState.database = 'sql';
        
        if (deps.passport || deps.jsonwebtoken || deps['next-auth'] || deps.bcrypt) this.projectState.authExists = true;
        if (deps.jest || deps.mocha || deps.chai || deps.vitest || deps.cypress) this.projectState.testsExist = true;
        
        if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) this.projectState.packageManager = 'yarn';
        else if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) this.projectState.packageManager = 'pnpm';
        else this.projectState.packageManager = 'npm';
        
        this.projectState.entryPoint = pkg.main || 'index.js';
      } catch (e) {
        // ignore JSON parse errors
      }
    } else if (fs.existsSync(path.join(workspaceRoot, 'requirements.txt')) || fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) {
      this.projectState.projectType = 'python';
      if (fs.existsSync(path.join(workspaceRoot, 'manage.py'))) this.projectState.framework = 'django';
    }
    
    this.projectState.lastScanned = Date.now();
  }

  // ─── Semantic Abstraction Layer ─────────────────────────────────────────────
  updateSemanticAbstraction(moduleId, { purpose, intent, roles }) {
    if (!this.semanticAbstractions[moduleId]) {
      this.semanticAbstractions[moduleId] = { purpose: '', intent: '', roles: [] };
    }
    if (purpose) this.semanticAbstractions[moduleId].purpose = purpose;
    if (intent)  this.semanticAbstractions[moduleId].intent  = intent;
    if (roles)   this.semanticAbstractions[moduleId].roles   = roles;
    this.updateConfidence(moduleId, 80);
  }

  getSemanticAbstraction(moduleId) {
    return this.semanticAbstractions[moduleId] || null;
  }

  // ─── Causal Relationships (Dependency Graph Engine) ─────────────────────────
  addDependency(sourceModule, targetModule) {
    if (!this.causalityGraph[sourceModule]) {
      this.causalityGraph[sourceModule] = { impacts: new Set(), dependsOn: new Set() };
    }
    if (!this.causalityGraph[targetModule]) {
      this.causalityGraph[targetModule] = { impacts: new Set(), dependsOn: new Set() };
    }
    this.causalityGraph[sourceModule].impacts.add(targetModule);
    this.causalityGraph[targetModule].dependsOn.add(sourceModule);
  }

  getImpactedModules(moduleId) {
    if (!this.causalityGraph[moduleId]) return [];
    return Array.from(this.causalityGraph[moduleId].impacts);
  }

  // ─── Temporal State ─────────────────────────────────────────────────────────
  /**
   * Record a tool action against a module.
   * Updates the flat nodes/edges spec-format alongside the raw temporalState.
   *
   * @param {string} moduleId      - File path or module name
   * @param {string} action        - Human-readable action label
   * @param {string} toolUsed      - Tool name (e.g. "fs.writeFile")
   * @param {string} resultSummary - "success" | "failed" | descriptive string
   * @param {string} [contentHash] - Optional SHA-1 of the file after the change
   */
  recordChange(moduleId, action, toolUsed, resultSummary, contentHash) {
    const ts      = Date.now();
    const success = !resultSummary?.toLowerCase().includes('fail');
    const hash    = contentHash || _shortHash(moduleId + ts);

    // Raw temporal log (unchanged behaviour)
    this.temporalState.push({ timestamp: ts, moduleId, action, toolUsed, resultSummary });

    // Spec-format node upsert
    this.nodes[moduleId] = {
      lastModified: ts,
      lastTool:     toolUsed,
      hash,
      status:       success ? 'success' : 'failed',
      confidence:   success ? 100 : Math.max(0, (this.confidenceScores[moduleId] || 50) - 20),
    };

    // Spec-format edge
    this.edges.push({ from: toolUsed, to: moduleId, timestamp: ts, success });

    // Cap edges to last 200 to avoid unbounded growth
    if (this.edges.length > 200) this.edges = this.edges.slice(-200);

    // Propagate confidence to dependents
    const impacted = this.getImpactedModules(moduleId);
    for (const dep of impacted) {
      this.updateConfidence(dep, Math.max(0, (this.confidenceScores[dep] || 100) - 30));
    }
    this.updateConfidence(moduleId, success ? 100 : 40);
  }

  getHistory(moduleId) {
    return this.temporalState.filter(e => e.moduleId === moduleId);
  }

  // ─── Confidence Scores ──────────────────────────────────────────────────────
  updateConfidence(moduleId, score) {
    this.confidenceScores[moduleId] = Math.max(0, Math.min(100, score));
    // Keep node in sync
    if (this.nodes[moduleId]) {
      this.nodes[moduleId].confidence = this.confidenceScores[moduleId];
    }
  }

  getConfidence(moduleId) {
    return this.confidenceScores[moduleId] !== undefined ? this.confidenceScores[moduleId] : 0;
  }

  // ─── Export / Import ────────────────────────────────────────────────────────
  serialize() {
    const serializedCausality = {};
    for (const [key, value] of Object.entries(this.causalityGraph)) {
      serializedCausality[key] = {
        impacts:   Array.from(value.impacts),
        dependsOn: Array.from(value.dependsOn),
      };
    }

    return {
      // Spec-format flat structures
      nodes: this.nodes,
      edges: this.edges,
      // Deep internals (for full fidelity restore)
      semanticAbstractions: this.semanticAbstractions,
      causalityGraph:       serializedCausality,
      temporalState:        this.temporalState,
      confidenceScores:     this.confidenceScores,
      projectState:         this.projectState,
    };
  }

  deserialize(data) {
    if (!data) return;

    // Spec-format
    this.nodes = data.nodes || {};
    this.edges = data.edges || [];

    // Deep internals
    this.semanticAbstractions = data.semanticAbstractions || {};
    this.temporalState        = data.temporalState        || [];
    this.confidenceScores     = data.confidenceScores     || {};
    this.projectState         = data.projectState         || this.projectState;

    if (data.causalityGraph) {
      for (const [key, value] of Object.entries(data.causalityGraph)) {
        this.causalityGraph[key] = {
          impacts:   new Set(value.impacts   || []),
          dependsOn: new Set(value.dependsOn || []),
        };
      }
    }
  }
}

// ─── Utility: short deterministic hash from a string ───────────────────────────
function _shortHash(str) {
  return crypto.createHash('sha1').update(String(str)).digest('hex').slice(0, 7);
}

module.exports = DeepWorldModel;
