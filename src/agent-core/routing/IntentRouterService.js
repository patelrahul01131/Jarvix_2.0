// src/agent-core/routing/IntentRouterService.js
const { AdaptiveRouter } = require("./AdaptiveRouter");
const { getDefaultIntent } = require("./IntentTaxonomy");

class IntentRouterService {
  constructor(rootPath) {
    this.adaptiveRouter = new AdaptiveRouter(rootPath);
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    await this.adaptiveRouter.init();
    this.initialized = true;
  }

  async route(goal, args, session) {
    if (!this.initialized) await this.init();
    const result = await this.adaptiveRouter.route(goal, args, session);
    const primaryIntent = getDefaultIntent(result.intent);
    
    // Override default intent properties with adaptive router's multi-dimensional outputs
    if (result.intent.startsWith("MEMORY_")) {
      primaryIntent.execution_mode = "memory";
    } else {
      primaryIntent.execution_mode = result.plannerRequired ? "agent" : "chat";
    }
    primaryIntent.complexity = result.expectedLatency > 1000 ? 70 : 15;
    
    return {
      primaryIntent,
      confidence: result.confidence,
      isDecomposed: false,
      source: result.confidence === 1.0 ? 'cache' : 'semantic',
      // Attach the original multi-dimensional results as well
      ...result
    };
  }
}

module.exports = { IntentRouterService };
