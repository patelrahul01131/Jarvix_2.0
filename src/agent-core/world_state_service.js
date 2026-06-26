'use strict';

/**
 * World State Service
 * 
 * Provides a cached, file-backed representation of the overall workspace architecture
 * (projectType, framework, db, auth).
 */

const fs = require('fs');
const path = require('path');
const DeepWorldModel = require('./worldModel');

const { getWorkspaceRoot } = require("../tools/fileSystem");

function getCacheDir() {
  const root = getWorkspaceRoot() || process.cwd();
  return path.join(root, '.jarvix');
}

function getStateFile() {
  return path.join(getCacheDir(), 'world_state_cache.json');
}

function ensureDir() {
  const dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

class WorldStateService {
  constructor() {
    this.cache = null;
    this.lastScannedRoot = null;
  }

  _readFromDisk() {
    const file = getStateFile();
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  _writeToDisk(data) {
    ensureDir();
    try {
      fs.writeFileSync(getStateFile(), JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[WorldStateService] Failed to cache world state:', e.message);
    }
  }

  getProjectState(workspaceRoot) {
    if (!workspaceRoot) return {};

    // Use memory cache if available and same root
    if (this.cache && this.lastScannedRoot === workspaceRoot) {
      // Re-scan if older than 5 minutes
      if (Date.now() - this.cache.lastScanned < 5 * 60 * 1000) {
        return this.cache;
      }
    }

    // Try disk cache
    const diskCache = this._readFromDisk();
    if (diskCache && diskCache.workspaceRoot === workspaceRoot) {
      if (Date.now() - diskCache.lastScanned < 5 * 60 * 1000) {
        this.cache = diskCache;
        this.lastScannedRoot = workspaceRoot;
        return this.cache;
      }
    }

    // Must re-scan
    const tempModel = new DeepWorldModel();
    tempModel.inferProjectState(workspaceRoot);
    
    this.cache = {
      workspaceRoot,
      ...tempModel.projectState
    };
    this.lastScannedRoot = workspaceRoot;
    
    // Fire and forget save
    this._writeToDisk(this.cache);
    
    return this.cache;
  }
}

const worldStateService = new WorldStateService();
module.exports = { worldStateService };
