const EventEmitter = require('events');

/**
 * EventBus Singleton
 * Decouples the Jarvix 4.0 architecture by routing domain events.
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    // Increase limit for a busy agent system
    this.setMaxListeners(50);
  }

  /**
   * Strongly typed event emitter wrapper to enforce payload standards
   */
  emitEvent(eventName, payload) {
    // Add standard metadata
    const eventPayload = {
      timestamp: new Date().toISOString(),
      ...payload
    };
    this.emit(eventName, eventPayload);
  }
}

// Export as a singleton
const eventBus = new EventBus();

// Standard Event Names
const EVENTS = {
  GOAL_CREATED: 'GoalCreated',
  GOAL_COMPLETED: 'GoalCompleted',
  GOAL_PAUSED: 'GoalPaused',
  GOAL_RESUMED: 'GoalResumed',
  GOAL_FAILED: 'GoalFailed',
  
  BELIEF_UPDATED: 'BeliefUpdated',
  BELIEF_SUPERSEDED: 'BeliefSuperseded',
  
  FAILURE_RECORDED: 'FailureRecorded',
  LESSON_LEARNED: 'LessonLearned',
  
  LOCK_ACQUIRED: 'LockAcquired',
  LOCK_RELEASED: 'LockReleased',
  LOCK_ESCALATED: 'LockEscalated',
  
  ROLLBACK_TRIGGERED: 'RollbackTriggered',
  SNAPSHOT_CREATED: 'SnapshotCreated',

  // AgentActivityFeed Event Vocabulary
  PLAN_CREATED: 'PlanCreated',
  TASK_STARTED: 'TaskStarted',
  PATCH_GROUP_CREATED: 'PatchGroupCreated',
  WAITING_FOR_APPROVAL: 'WaitingForApproval',
  PATCH_APPROVED: 'PatchApproved',
  PATCH_REJECTED: 'PatchRejected',
  PATCH_APPLIED: 'PatchApplied',
  USER_FEEDBACK_RECEIVED: 'UserFeedbackReceived',
  REPLAN_TRIGGERED: 'ReplanTriggered',
  REFLECTION_COMPLETE: 'ReflectionComplete'
};

module.exports = { eventBus, EVENTS };
