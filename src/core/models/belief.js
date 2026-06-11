/**
 * Belief Domain Model
 * Represents an inferred piece of knowledge with history and confidence.
 */
class Belief {
  constructor(data = {}) {
    this.key = data.key || ""; // e.g., 'framework', 'user_age'
    this.currentValue = data.currentValue || null;
    this.confidence = data.confidence || 0.0; // 0.0 to 1.0
    
    // Maintain history of superseded values to resolve contradictions
    this.history = data.history || []; 
    // Array of { value, confidence, supersededAt, reason }
    this.superseded = data.superseded || []; 
    
    this.lastVerified = data.lastVerified || new Date().toISOString();
  }

  update(newValue, newConfidence, reason) {
    if (this.currentValue !== null) {
      this.history.push(this.currentValue);
      this.superseded.push({
        value: this.currentValue,
        confidence: this.confidence,
        supersededAt: new Date().toISOString(),
        reason: reason
      });
    }
    this.currentValue = newValue;
    this.confidence = newConfidence;
    this.lastVerified = new Date().toISOString();
  }
}

module.exports = Belief;
