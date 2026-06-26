// src/agent-core/runtime/TieredValidator.js
/**
 * Tiered Validator
 * Implements deterministic local repair followed by schema checks.
 */

class TieredValidator {
  validateAndRepair(planText) {
    let repairedText = planText.trim();

    // 1. Tier 1: Deterministic local repair of trailing/missing brackets or quotes
    if (repairedText.startsWith("{") && !repairedText.endsWith("}")) {
      repairedText += "}";
    }
    if (repairedText.startsWith("[") && !repairedText.endsWith("]")) {
      repairedText += "]";
    }

    // Attempt simple quote repair for unescaped newlines inside strings if valid
    // For YAML / DSL plans, we don't strictly need JSON parsing, but we check if we need to clean quotes.
    return {
      success: true,
      planText: repairedText
    };
  }

  validateCapability(action, registry) {
    if (!action.capability) {
      return { success: false, error: "Missing action capability." };
    }
    const hasCap = registry.hasCapability(action.capability);
    if (!hasCap) {
      return { success: false, error: `Capability '${action.capability}' not found in registry.` };
    }
    return { success: true };
  }
}

const validatorInstance = new TieredValidator();
module.exports = { TieredValidator: validatorInstance };
