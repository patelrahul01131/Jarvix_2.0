/**
 * Loop Detector
 * Intelligent multi-dimensional loop detection to prevent agent runaway behavior.
 */

class LoopDetector {
  constructor() {
    this.errorStreak = 0;
    this.recentActions = [];
    this.maxWindow = 10;
  }

  /**
   * Record an action and its result, then check if the agent is stuck in a loop.
   * @param {Object} action The agent action (tool call)
   * @param {Object} result The result of the execution
   * @returns {Object} { isLoop: boolean, reason: string }
   */
  recordAction(action, result) {
    if (!action || !action.tool) return { isLoop: false, reason: "" };

    const isError = result && result.success === false;

    // Dimension 1: Error Streak Detection
    if (isError) {
      this.errorStreak += 1;
    } else {
      // Only reset error streak on a true success
      this.errorStreak = 0;
    }

    if (this.errorStreak >= 3) {
      return { 
        isLoop: true, 
        reason: "The agent encountered 3 consecutive execution errors and is stuck." 
      };
    }

    // Dimension 2: Semantic Similarity / Fingerprinting
    const fingerprint = `${action.tool}:${JSON.stringify(action.input)}`;
    this.recentActions.push(fingerprint);
    if (this.recentActions.length > this.maxWindow) {
      this.recentActions.shift();
    }

    // Check if the exact same action has been repeated 3 times within the window
    const actionCounts = {};
    for (const act of this.recentActions) {
      actionCounts[act] = (actionCounts[act] || 0) + 1;
      if (actionCounts[act] >= 3) {
        return {
          isLoop: true,
          reason: `The agent repeated the exact same action 3 times: ${action.tool}`
        };
      }
    }

    return { isLoop: false, reason: "" };
  }

  reset() {
    this.errorStreak = 0;
    this.recentActions = [];
  }
}

module.exports = LoopDetector;
