"use strict";

/**
 * Intent Router (Legacy Proxy) — src/agent-core/intent_router.js
 *
 * This file has been upgraded to proxy to the new Semantic Routing Architecture.
 * See src/agent-core/routing/IntentRouterService.js
 */

const path = require("path");
const { IntentRouterService } = require("./routing/IntentRouterService");

let routerServiceInstance = null;

function getRouter(rootPath) {
  if (!routerServiceInstance) {
    routerServiceInstance = new IntentRouterService(rootPath);
  }
  return routerServiceInstance;
}

/**
 * Classify the user's goal into a structured intent (Backward compatible)
 *
 * @param {string} goal        - The user's raw input
 * @param {object} args        - Runtime args: { model, provider }
 * @param {object} [session]   - Current session (for recent message context)
 * @returns {Promise<IntentClassification>}
 */
async function classifyIntent(goal, args, session) {
  if (!goal) {
    // Default fallback
    const { getDefaultIntent } = require("./routing/IntentTaxonomy");
    return getDefaultIntent("QA_GENERAL");
  }

  // We assume process.cwd() or a workspace root is used. For testing, use path.resolve.
  // In a real environment, rootPath should be passed in args or session, but we use process.cwd() as fallback.
  const rootPath = args?.rootPath || process.cwd();
  
  const router = getRouter(rootPath);
  
  try {
    const routeResult = await router.route(goal, args, session);
    console.log(`[IntentRouter] Routed as ${routeResult.primaryIntent.intent} (Confidence: ${routeResult.confidence.toFixed(2)}) [Source: ${routeResult.source}]`);
    return routeResult.primaryIntent;
  } catch (err) {
    console.error("[IntentRouter] Critical Failure in Semantic Router. Falling back to QA_GENERAL.", err);
    return require("./routing/IntentTaxonomy").getDefaultIntent("QA_GENERAL");
  }
}

module.exports = { classifyIntent };
