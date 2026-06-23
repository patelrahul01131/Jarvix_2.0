"use strict";

/**
 * Belief Domain Model
 * Represents an inferred piece of knowledge with confidence and history.
 *
 * Persisted format (inside session.beliefData as array of [key, Belief]):
 * {
 *   "value": "shortTerm.js",
 *   "confidence": 0.9,
 *   "lastUpdated": 1719239900000,
 *   "superseded": false
 * }
 */
class Belief {
  constructor(data = {}) {
    this.key = data.key || "";

    // Primary field name is "value"; accept "currentValue" for backward compat
    this.value = data.value ?? data.currentValue ?? null;

    this.confidence = data.confidence || 0.0; // 0.0 – 1.0
    this.lastUpdated = data.lastUpdated || Date.now();
    this.superseded = data.superseded || false; // true when a newer belief replaced this

    // Rich history for contradiction resolution
    this.history = data.history || []; // past values (plain array)
    this.supLog = data.supLog || []; // { value, confidence, supersededAt, reason }
  }

  // ─── Backward compat getter so old code reading .currentValue still works ───
  get currentValue() {
    return this.value;
  }
  set currentValue(v) {
    this.value = v;
  }

  /**
   * Update belief with a new value, archiving the old one.
   */
  update(newValue, newConfidence, reason) {
    if (this.value !== null) {
      this.history.push(this.value);
      this.supLog.push({
        value: this.value,
        confidence: this.confidence,
        supersededAt: new Date().toISOString(),
        reason: reason || "update",
      });
      this.superseded = true; // mark old state superseded before overwrite
    }
    this.value = newValue;
    this.confidence = newConfidence;
    this.lastUpdated = Date.now();
    this.superseded = false; // the new value is current, not superseded
  }

  /**
   * Serialise to the compact persisted format.
   */
  toJSON() {
    return {
      value: this.value,
      confidence: this.confidence,
      lastUpdated: this.lastUpdated,
      superseded: this.superseded,
    };
  }
}

module.exports = Belief;
