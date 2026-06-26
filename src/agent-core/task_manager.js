'use strict';

/**
 * Task Manager — src/agent-core/task_manager.js
 *
 * Manages persistent agent task states across conversation turns.
 * Helps prevent the agent from losing the plot by formalizing its progress
 * instead of relying solely on chat history.
 */

const fs = require('fs');
const path = require('path');
const { persistenceManager } = require('../memory/PersistenceManager');
const { contextRetriever } = require('../retrieval/context_retriever');

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

const { getWorkspaceRoot } = require("../tools/fileSystem");

function getTasksDir() {
  const root = getWorkspaceRoot() || process.cwd();
  return path.join(root, '.jarvix', 'tasks');
}

function ensureDir() {
  const dir = getTasksDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function taskFilePath(sessionId) {
  if (!sessionId) return null;
  const safe = String(sessionId).replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(getTasksDir(), `${safe}_tasks.json`);
}

function generateTaskId() {
  return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
}

class TaskManager {
  constructor() {
    this.cache = new Map();
  }

  _readFromDisk(sessionId) {
    const filePath = taskFilePath(sessionId);
    if (!fs.existsSync(filePath)) return {};
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  _writeToDisk(sessionId, tasksObject) {
    ensureDir();
    const filePath = taskFilePath(sessionId);
    const snapshot = JSON.stringify(tasksObject, null, 2);
    persistenceManager.scheduleWrite(filePath, snapshot, 150);
  }

  _getSessionTasks(sessionId) {
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId);
    }
    const tasks = this._readFromDisk(sessionId);
    this.cache.set(sessionId, tasks);
    return tasks;
  }

  _saveSessionTasks(sessionId, tasksObject) {
    this.cache.set(sessionId, tasksObject);
    this._writeToDisk(sessionId, tasksObject);
  }

  /**
   * Resumes the active task for the session, or creates a new one if none exists or the topic drastically changed.
   */
  async createOrResume(sessionId, goal) {
    const tasks = this._getSessionTasks(sessionId);
    
    // Look for an active task
    let activeTask = Object.values(tasks).find(t => t.status === 'active' || t.status === 'pending');
    
    // If no goal is explicitly provided, we just return the active task
    if (!goal) {
      return activeTask || null;
    }

    if (activeTask && activeTask.goal) {
      const oldVec = contextRetriever._generateEmbedding(activeTask.goal);
      const newVec = contextRetriever._generateEmbedding(goal);
      
      // Calculate semantic similarity + 1 / 2 to normalize from -1,1 to 0,1
      let sim = cosineSimilarity(oldVec, newVec);
      sim = (sim + 1) / 2;

      if (sim >= 0.85) {
        return activeTask;
      } else if (sim >= 0.50) {
        // Technically should ask for clarification, but we will assume resume for now
        // to avoid blocking execution, but we'll log it.
        console.warn(`[TaskManager] Task similarity ${sim.toFixed(2)} is marginal. Resuming anyway.`);
        return activeTask;
      }
      
      // < 0.50 means it's a completely new topic. Mark old as completed.
      console.log(`[TaskManager] Task similarity ${sim.toFixed(2)} is low. Creating new task.`);
      activeTask.status = 'completed';
      this._saveSessionTasks(sessionId, tasks);
    }

    // Create a new task
    const taskId = generateTaskId();
    const now = Date.now();
    const newTask = {
      taskId,
      sessionId,
      goal,
      status: 'active',
      currentStep: 0,
      completedSteps: [],
      pendingSteps: [],
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };

    tasks[taskId] = newTask;
    this._saveSessionTasks(sessionId, tasks);
    return newTask;
  }

  getTask(sessionId, taskId) {
    const tasks = this._getSessionTasks(sessionId);
    return tasks[taskId] || null;
  }

  getCurrentTask(sessionId) {
    const tasks = this._getSessionTasks(sessionId);
    return Object.values(tasks).find(t => t.status === 'active' || t.status === 'pending') || null;
  }

  updateStatus(sessionId, taskId, status) {
    const tasks = this._getSessionTasks(sessionId);
    if (tasks[taskId]) {
      tasks[taskId].status = status;
      tasks[taskId].updatedAt = Date.now();
      this._saveSessionTasks(sessionId, tasks);
    }
  }

  addCompletedStep(sessionId, taskId, stepDesc) {
    const tasks = this._getSessionTasks(sessionId);
    if (tasks[taskId]) {
      // Avoid duplicate exact steps
      if (!tasks[taskId].completedSteps.includes(stepDesc)) {
        tasks[taskId].completedSteps.push(stepDesc);
        tasks[taskId].currentStep = tasks[taskId].completedSteps.length;
        tasks[taskId].updatedAt = Date.now();
        this._saveSessionTasks(sessionId, tasks);
      }
    }
  }

  addPendingSteps(sessionId, taskId, stepsArray) {
    const tasks = this._getSessionTasks(sessionId);
    if (tasks[taskId]) {
      tasks[taskId].pendingSteps = stepsArray;
      tasks[taskId].updatedAt = Date.now();
      this._saveSessionTasks(sessionId, tasks);
    }
  }

  setBlockedReason(sessionId, taskId, reason) {
    const tasks = this._getSessionTasks(sessionId);
    if (tasks[taskId]) {
      tasks[taskId].blockedReason = reason;
      tasks[taskId].status = reason ? 'blocked' : 'active';
      tasks[taskId].updatedAt = Date.now();
      this._saveSessionTasks(sessionId, tasks);
    }
  }

  serialize(sessionId, taskId) {
    const task = this.getTask(sessionId, taskId);
    if (!task) return null;
    return {
      taskId: task.taskId,
      goal: task.goal,
      status: task.status,
      currentStep: task.currentStep,
      completedSteps: task.completedSteps,
      pendingSteps: task.pendingSteps,
      blockedReason: task.blockedReason,
    };
  }
}

// Singleton export
const taskManager = new TaskManager();
module.exports = { taskManager };
