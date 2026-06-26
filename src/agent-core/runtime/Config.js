// src/agent-core/runtime/Config.js
/**
 * Configuration module defining Model Profiles, Feature Flags, and Resource Budgets.
 */

const MODEL_PROFILES = {
  fast_chat: {
    model: "gemini-2.5-flash",
    provider: "gemini"
  },
  planner: {
    model: "gemini-2.5-pro",
    provider: "gemini"
  },
  formatter: {
    model: "gemini-2.5-flash",
    provider: "gemini"
  }
};

const FEATURE_FLAGS = {
  ENABLE_FAST_PATH: true,
  ENABLE_DAG: true,
  ENABLE_PARALLEL: true,
  ENABLE_CONTEXT_V2: true,
  ENABLE_VALIDATOR: true,
  ENABLE_CACHE: true,
  ENABLE_ROUTER_V2: true
};

const RESOURCE_BUDGETS = {
  maxToolCalls: 10,
  maxExecutionTimeSeconds: 60,
  maxContextTokens: 4000
};

module.exports = {
  MODEL_PROFILES,
  FEATURE_FLAGS,
  RESOURCE_BUDGETS
};
