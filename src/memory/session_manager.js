/**
 * @typedef {Object} Checkpoint
 * @property {string} id
 * @property {string} description
 * @property {number} timestamp
 */

/**
 * @typedef {Object} SessionState
 * @property {string} sessionId
 * @property {string} currentGoal
 * @property {string[]} activeTasks
 * @property {Checkpoint[]} checkpoints
 * @property {number} startedAt
 * @property {number} updatedAt
 */

class SessionManager {
  constructor() {
    /** @type {Map<string, SessionState>} */
    this.sessions = new Map();
  }

  /**
   * Initializes or retrieves a session
   * @param {string} sessionId 
   * @param {string} initialGoal 
   * @returns {SessionState}
   */
  getOrCreateSession(sessionId, initialGoal = "") {
    if (this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      if (initialGoal && session.currentGoal !== initialGoal) {
        session.currentGoal = initialGoal;
        session.updatedAt = Date.now();
      }
      return session;
    }

    const newSession = {
      sessionId,
      currentGoal: initialGoal,
      activeTasks: [],
      checkpoints: [],
      startedAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.sessions.set(sessionId, newSession);
    return newSession;
  }

  /**
   * Updates session goal
   * @param {string} sessionId 
   * @param {string} newGoal 
   */
  updateGoal(sessionId, newGoal) {
    const session = this.getOrCreateSession(sessionId);
    session.currentGoal = newGoal;
    session.updatedAt = Date.now();
  }

  /**
   * Adds an active task to the session
   * @param {string} sessionId 
   * @param {string} task 
   */
  addTask(sessionId, task) {
    const session = this.getOrCreateSession(sessionId);
    if (!session.activeTasks.includes(task)) {
      session.activeTasks.push(task);
      session.updatedAt = Date.now();
    }
  }

  /**
   * Completes and removes an active task, logging a checkpoint
   * @param {string} sessionId 
   * @param {string} task 
   */
  completeTask(sessionId, task) {
    const session = this.getOrCreateSession(sessionId);
    session.activeTasks = session.activeTasks.filter(t => t !== task);
    this.addCheckpoint(sessionId, `Completed task: ${task}`);
  }

  /**
   * Adds a checkpoint to the session history
   * @param {string} sessionId 
   * @param {string} description 
   */
  addCheckpoint(sessionId, description) {
    const session = this.getOrCreateSession(sessionId);
    session.checkpoints.push({
      id: Math.random().toString(36).substring(7),
      description,
      timestamp: Date.now()
    });
    session.updatedAt = Date.now();
  }
}

const sessionManager = new SessionManager();
module.exports = { sessionManager, SessionManager };
