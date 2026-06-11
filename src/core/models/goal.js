/**
 * Goal Domain Model
 * Represents an objective in the Jarvix 4.0 Goal Tree.
 */
class Goal {
  constructor(data = {}) {
    this.id = data.id || `goal_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.parentGoalId = data.parentGoalId || null;
    this.title = data.title || "Unknown Goal";
    this.description = data.description || "";
    
    // active, blocked, completed, paused, cancelled
    this.status = data.status || "active";
    
    // Array of Goal IDs that this goal depends on before it can execute
    this.dependencies = data.dependencies || [];
    
    this.priority = data.priority || "normal"; // low, normal, high, critical
    this.confidence = data.confidence || 1.0;
    
    this.successCriteria = data.successCriteria || [];
    this.createdAt = data.createdAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();
  }

  isBlocked() {
    return this.status === "blocked";
  }

  isActive() {
    return this.status === "active";
  }
}

module.exports = Goal;
