'use strict';

/**
 * Profile Store — src/memory/profile_store.js
 *
 * Manages the long-term User Profile (beliefs, facts, project settings)
 * by persisting it to `sessions/user_profile.json`.
 */

const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require("../tools/fileSystem");

function getSessionsDir() {
  const root = getWorkspaceRoot() || process.cwd();
  return path.join(root, '.jarvix');
}

function getProfileFile() {
  return path.join(getSessionsDir(), 'user_profile.json');
}

let userProfileCache = null;
let _ltmWriteTimer   = null;
let _cachedProfileFile = null; // Tracks which file the cache was loaded from

/**
 * V3 schema:
 * permanent.user        → rich object  { name, role, skills[], goals[] }
 * permanent.projects    → object       { id: { name, description, stack[] } }
 * permanent.preferences → object       { codeStyle, verbosity, architectureBias }
 * permanent.relationships → object     { id: { entity, type } }
 */
function _v3Default() {
  return {
    _version: 3,
    permanent: {
      user:          {},
      projects:      {},
      preferences:   {},
      relationships: {},
    },
    session: {
      instructions:     [],
      temporary_context: [],
    },
  };
}

function getLongTermMemory() {
  const profileFile = getProfileFile();

  // ─ Cache invalidation: if workspace changed, reload from new path ──────────
  if (userProfileCache && _cachedProfileFile && _cachedProfileFile !== profileFile) {
    console.log(`[LTM] Workspace changed (${_cachedProfileFile} → ${profileFile}). Reloading profile.`);
    userProfileCache = null;
    _cachedProfileFile = null;
  }

  if (userProfileCache) return userProfileCache;

  const defaultProfile = _v3Default();

  // profileFile is already declared above from getProfileFile()
  if (!fs.existsSync(profileFile)) {
    userProfileCache = defaultProfile;
    _cachedProfileFile = profileFile;
    return userProfileCache;
  }
  try {
    userProfileCache = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
    _cachedProfileFile = profileFile;

    // ─── Migration V1/V2 → V3 ───────────────────────────────────────────────
    const v = userProfileCache._version || 0;
    
    // Check if relationships or projects are arrays (stale v3 schema or older)
    const needsMigration = v < 3 || 
      Array.isArray(userProfileCache?.permanent?.projects) || 
      Array.isArray(userProfileCache?.permanent?.relationships);

    if (needsMigration) {
      const migrated = _v3Default();
      const src = userProfileCache.permanent || {};

      // Carry over user and preferences as-is
      migrated.permanent.user        = src.user        || {};
      migrated.permanent.preferences = src.preferences || {};

      // V1: flat name field
      if (v <= 1 && userProfileCache.name) {
        migrated.permanent.user.name = userProfileCache.name;
      }

      // Convert projects to object (fixed ternary: p.id || p.name was evaluated as boolean)
      if (src.projects) {
        if (Array.isArray(src.projects)) {
          migrated.permanent.projects = src.projects.reduce((acc, p, idx) => {
            const id = p.id ? p.id : (p.name ? `project_${p.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : `project_${idx + 1}`);
            acc[id] = p;
            return acc;
          }, {});
        } else {
          migrated.permanent.projects = src.projects;
        }
      }

      // Convert relationships to object (same fix)
      if (src.relationships) {
        if (Array.isArray(src.relationships)) {
          migrated.permanent.relationships = src.relationships.reduce((acc, r, idx) => {
            const id = r.id ? r.id : (r.name ? `rel_${r.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : `rel_${idx + 1}`);
            acc[id] = r;
            return acc;
          }, {});
        } else {
          migrated.permanent.relationships = src.relationships;
        }
      }

      migrated.session  = userProfileCache.session || migrated.session;
      userProfileCache  = migrated;
      console.log(`[LTM] Migrated user profile structure to version 3 object-based schemas`);

      // ── Immediately write migrated profile back to disk so stale arrays don't persist ──
      try {
        fs.writeFileSync(profileFile, JSON.stringify(migrated, null, 2), 'utf8');
        console.log('[LTM] Migrated profile saved to disk.');
      } catch (writeErr) {
        console.warn('[LTM] Could not write migrated profile to disk:', writeErr.message);
      }
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
  const sessionsDir = getSessionsDir();
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  const snapshot = JSON.stringify(newProfile, null, 2);
  if (_ltmWriteTimer) clearTimeout(_ltmWriteTimer);
  _ltmWriteTimer = setTimeout(() => {
    _ltmWriteTimer = null;
    fs.promises
      .writeFile(getProfileFile(), snapshot, 'utf8')
      .catch((e) => console.error('[LTM] Failed to save user profile:', e.message));
  }, 200);
}

module.exports = {
  getLongTermMemory,
  updateLongTermMemory,
};
