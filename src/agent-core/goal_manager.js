const { eventBus, EVENTS } = require("../core/event_bus");
const Goal = require("../core/models/goal");

/**
 * GoalManager
 * Manages the Goal Tree and Goal Graph execution queues.
 */
class GoalManager {
  constructor() {
    this.goals = new Map(); // Map<GoalId, Goal>
    
    // Priority queues based on priority level
    this.activeQueue = [];
    this.blockedQueue = [];
  }

  createGoal(data) {
    const goal = new Goal(data);
    this.goals.set(goal.id, goal);
    
    if (goal.dependencies.length > 0) {
      goal.status = "blocked";
      this.blockedQueue.push(goal.id);
    } else {
      goal.status = "active";
      this.activeQueue.push(goal.id);
    }
    
    // Sort queues by priority (crude priority logic: critical > high > normal > low)
    this._sortQueue(this.activeQueue);
    
    eventBus.emitEvent(EVENTS.GOAL_CREATED, { goal });
    return goal;
  }

  getGoal(id) {
    return this.goals.get(id);
  }

  updateGoalStatus(id, newStatus) {
    const goal = this.goals.get(id);
    if (!goal) return null;
    
    const oldStatus = goal.status;
    goal.status = newStatus;
    goal.updatedAt = new Date().toISOString();
    
    // Manage queues
    this.activeQueue = this.activeQueue.filter(gid => gid !== id);
    this.blockedQueue = this.blockedQueue.filter(gid => gid !== id);
    
    if (newStatus === "active") this.activeQueue.push(id);
    if (newStatus === "blocked") this.blockedQueue.push(id);
    
    this._sortQueue(this.activeQueue);
    
    if (newStatus === "completed") {
      eventBus.emitEvent(EVENTS.GOAL_COMPLETED, { goalId: id });
      this._resolveDependencies(id);
    } else if (newStatus === "paused") {
      eventBus.emitEvent(EVENTS.GOAL_PAUSED, { goalId: id });
    } else if (newStatus === "failed") {
      eventBus.emitEvent(EVENTS.GOAL_FAILED, { goalId: id });
    } else if (oldStatus === "paused" && newStatus === "active") {
      eventBus.emitEvent(EVENTS.GOAL_RESUMED, { goalId: id });
    }
    
    return goal;
  }

  /**
   * Returns the next highest-priority active goal.
   */
  getNextGoal() {
    if (this.activeQueue.length === 0) return null;
    return this.goals.get(this.activeQueue[0]);
  }

  /**
   * Cancel a goal and recursively cancel all its children.
   */
  cancelGoalTree(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    this.updateGoalStatus(goalId, "cancelled");
    
    // Find children
    for (const [id, g] of this.goals.entries()) {
      if (g.parentGoalId === goalId) {
        this.cancelGoalTree(id); // Recurse
      }
    }
  }

  _resolveDependencies(completedGoalId) {
    // Check blocked goals to see if they are unblocked
    for (const blockedId of [...this.blockedQueue]) {
      const blockedGoal = this.goals.get(blockedId);
      
      const remainingDeps = blockedGoal.dependencies.filter(depId => {
        const depGoal = this.goals.get(depId);
        return depGoal && depGoal.status !== "completed";
      });
      
      if (remainingDeps.length === 0) {
        // Unblocked!
        this.updateGoalStatus(blockedId, "active");
      }
    }
  }

  _sortQueue(queue) {
    const priorityWeights = { critical: 4, high: 3, normal: 2, low: 1 };
    queue.sort((aId, bId) => {
      const a = this.goals.get(aId);
      const b = this.goals.get(bId);
      if (!a || !b) return 0;
      return (priorityWeights[b.priority] || 2) - (priorityWeights[a.priority] || 2);
    });
  }
}

// Singleton
const goalManager = new GoalManager();

module.exports = { GoalManager, goalManager };
