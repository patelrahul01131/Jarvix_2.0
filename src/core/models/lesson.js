/**
 * Lesson Domain Model
 * A heuristic rule learned from episodic successes/failures.
 * Behaves like a belief with decay.
 */
class Lesson {
  constructor(data = {}) {
    this.id = data.id || `lesson_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.condition = data.condition || ""; // e.g., 'when_offline'
    this.action = data.action || ""; // e.g., 'prefer_local_cache'
    
    this.confidence = data.confidence || 1.0;
    this.observedCount = data.observedCount || 1;
    this.successCount = data.successCount || 1;
    
    this.lastVerified = data.lastVerified || new Date().toISOString();
  }

  recordSuccess() {
    this.observedCount++;
    this.successCount++;
    this.confidence = this.successCount / this.observedCount;
    this.lastVerified = new Date().toISOString();
  }

  recordFailure() {
    this.observedCount++;
    this.confidence = this.successCount / this.observedCount;
    this.lastVerified = new Date().toISOString();
  }

  isReliable(threshold = 0.5) {
    return this.confidence >= threshold;
  }
}

module.exports = Lesson;
