'use strict';

// Proxy module to preserve imports for existing callers
// Phase B Monolith Decomposition

const sessionStore = require('./session_store');
const profileStore = require('./profile_store');
const contextCompactor = require('./context_compactor');

module.exports = {
  // Session CRUD
  getSession: sessionStore.getSession,
  saveSession: sessionStore.saveSession,
  deleteSession: sessionStore.deleteSession,
  getAllSessions: sessionStore.getAllSessions,
  clearAllSessions: sessionStore.clearAllSessions,
  
  // Long-Term Memory (Profile)
  getLongTermMemory: profileStore.getLongTermMemory,
  updateLongTermMemory: profileStore.updateLongTermMemory,
  
  // Episodic compression & retrieval
  compressSession: contextCompactor.compressSession,
  getAttentiveMemory: contextCompactor.getAttentiveMemory,
  
  // Utilities (used by tests and other modules)
  identifyMessageSegments: contextCompactor.identifyMessageSegments,
  extractKeyEvents: contextCompactor.extractKeyEvents,
  extractFileChanges: contextCompactor.extractFileChanges,
  extractCodeSnippets: contextCompactor.extractCodeSnippets,
};
