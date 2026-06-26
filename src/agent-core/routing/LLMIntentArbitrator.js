const { callLLM } = require("../llmClient");
const { extractJson } = require("../../core/utils");
const { INTENT_CLASSIFIER_PROMPT } = require("../../rules/prompts");

class LLMIntentArbitrator {
  constructor() {
    this.failureCount = 0;
    this.circuitOpen = false;
    this.lastFailure = 0;
    this.CIRCUIT_TIMEOUT = 60000; // 1 minute
  }

  /**
   * Optional LLM arbitration for ambiguous intents
   */
  async arbitrate(goal, session, args) {
    if (this.circuitOpen) {
      if (Date.now() - this.lastFailure > this.CIRCUIT_TIMEOUT) {
        this.circuitOpen = false;
      } else {
        console.warn("[Arbitrator] Circuit breaker open, bypassing LLM.");
        return null; // Fallback to whatever semantic router predicted
      }
    }

    try {
      const messages = [{ role: "user", content: goal }];
      const system = INTENT_CLASSIFIER_PROMPT.replace("{{input}}", goal);

      const { reply } = await callLLM({
        messages,
        system,
        model: args?.model || 'gemini-2.5-pro',
        provider: args?.provider || 'gemini',
        onChunk: null,
        signal: null
      });

      const result = extractJson(reply);
      this.failureCount = 0; // reset
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailure = Date.now();
      if (this.failureCount > 2) {
        this.circuitOpen = true;
      }
      console.warn("[Arbitrator] LLM Failure:", err.message);
      return null;
    }
  }
}

module.exports = { LLMIntentArbitrator };
