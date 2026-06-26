// src/agent-core/routing/AdaptiveRouter.js
const { SemanticIntentRouter } = require("./SemanticIntentRouter");
const { LLMIntentArbitrator } = require("./LLMIntentArbitrator");
const { FEATURE_FLAGS } = require("../runtime/Config");

class AdaptiveRouter {
  constructor(rootPath) {
    this.semanticRouter = new SemanticIntentRouter(rootPath);
    this.arbitrator = new LLMIntentArbitrator();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await this.semanticRouter.init();
    this.initialized = true;
  }

  async route(message, args, session) {
    if (!this.initialized) await this.init();

    // 1. Check local fast-path shortcuts for extremely low latency
    const cleanMsg = message.trim().toLowerCase();
    const commonGreetings = ["hello", "hi", "hey", "good morning", "good afternoon", "greetings", "howdy"];
    if (commonGreetings.includes(cleanMsg)) {
      return {
        intent: "QA_GENERAL",
        complexity: "low",
        plannerRequired: false,
        modelProfile: "fast_chat",
        confidence: 1.0,
        expectedTokens: 100,
        expectedLatency: 150,
        toolCalls: 0
      };
    }

    // 2. Fall back to Semantic similarity
    const semanticResult = await this.semanticRouter.classify(message);
    let predictedIntent = "QA_GENERAL";
    let confidence = 0.5;

    if (semanticResult) {
      predictedIntent = semanticResult.intent;
      confidence = semanticResult.confidence;
    }

    // 3. If confidence is low, arbitrate using LLM
    if (confidence < 0.8 && FEATURE_FLAGS.ENABLE_ROUTER_V2) {
      const llmResult = await this.arbitrator.arbitrate(message, session, args);
      if (llmResult && llmResult.intent) {
        predictedIntent = llmResult.intent;
        confidence = llmResult.confidence || 0.85;
      }
    }

    // 4. Map Intent to Complexity & Profile
    const isMemory = ["MEMORY_READ", "MEMORY_WRITE", "MEMORY_DELETE"].includes(predictedIntent);
    const isGeneral = ["QA_GENERAL", "CHAT"].includes(predictedIntent);
    
    let complexity = "medium";
    let plannerRequired = true;
    let modelProfile = "planner";
    let expectedTokens = 800;
    let expectedLatency = 1500;
    let toolCalls = 3;

    if (isMemory || isGeneral) {
      complexity = "low";
      plannerRequired = false;
      modelProfile = "fast_chat";
      expectedTokens = 150;
      expectedLatency = 300;
      toolCalls = 0;
    } else if (predictedIntent === "ATOMIC_EDIT") {
      complexity = "low";
      plannerRequired = false;
      modelProfile = "fast_chat";
      expectedTokens = 300;
      expectedLatency = 600;
      toolCalls = 1;
    }

    return {
      intent: predictedIntent,
      complexity,
      plannerRequired,
      modelProfile,
      confidence,
      expectedTokens,
      expectedLatency,
      toolCalls
    };
  }
}

module.exports = { AdaptiveRouter };
