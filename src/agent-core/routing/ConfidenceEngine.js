class ConfidenceEngine {
  constructor() {
    this.thresholds = {
      IMMEDIATE_ROUTE: 0.85,
      VERIFY_ROUTE: 0.65,
      LLM_ARBITRATION: 0.40
    };
  }

  /**
   * Calibrate confidence based on contextual factors
   */
  calibrate(rawConfidence, text, intent) {
    let calibrated = rawConfidence;

    // Penalty for extremely short text if it's not a generic QA
    if (text.length < 10 && intent !== 'QA_GENERAL') {
      calibrated -= 0.1;
    }

    // Boost if explicit keywords exactly match the intent (Regex helper)
    if (intent === 'WEB_SEARCH' && /^(search|google|find out|look up)/i.test(text)) {
      calibrated += 0.15;
    }

    if (intent.startsWith('MEMORY_') && /^(remember|forget|recall|what do you know)/i.test(text)) {
      calibrated += 0.15;
    }

    // Clamp between 0 and 1
    return Math.max(0, Math.min(1, calibrated));
  }

  getAction(confidence) {
    if (confidence >= this.thresholds.IMMEDIATE_ROUTE) return 'ROUTE';
    if (confidence >= this.thresholds.VERIFY_ROUTE) return 'VERIFY';
    if (confidence >= this.thresholds.LLM_ARBITRATION) return 'ARBITRATE';
    return 'ASK_USER';
  }
}

module.exports = { ConfidenceEngine };
