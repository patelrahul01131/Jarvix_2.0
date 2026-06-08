/**
 * Reflection & Fixer Node Module
 * Evaluates the outcome of an execution step and repairs broken plans.
 */
const { callLLM } = require("./llmClient");
const { FIXER_SYSTEM_PROMPT } = require("../rules/prompts");


async function runReflection(context, args) {
  console.log(`[Reflection] Analyzing result of step ${context.plan[context.currentStep]?.action}`);
  
  const lastResult = context.lastResult;

  if (!lastResult.success) {
    const fullOutput = (lastResult.stderr || "") + "\n" + (lastResult.stdout || "");
    const errorContext = fullOutput.trim().slice(-2000); // Last 2000 chars usually have the stack trace

    console.warn(`[Reflection] Step failed: ${errorContext}`);
    
    // FIXER NODE LOGIC
    if (args && args.onStatus) args.onStatus("🛠️ Attempting to repair broken plan...");

    try {
      const messages = [
        {
          role: "user",
          content: `GOAL: ${context.goal}\n\nFAILED STEP: ${JSON.stringify(context.plan[context.currentStep])}\n\nERROR TRACE:\n${errorContext}\n\nPlease provide a repaired JSON plan.`
        }
      ];

      const { reply } = await callLLM({
        messages,
        system: FIXER_SYSTEM_PROMPT,
        model: args.model,
        provider: args.provider,
        onChunk: null,
        signal: args.signal
      });

      const jsonMatch = reply.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const repairedPlan = JSON.parse(jsonMatch[0]);
        // Update context with new plan
        if (repairedPlan.steps) {
          return { success: false, error: lastResult.stderr, replanNeeded: false, newPlan: repairedPlan.steps };
        }
      }
    } catch (e) {
      console.error("[Fixer] Failed to repair plan:", e);
    }
    
    return { success: false, error: lastResult.stderr, replanNeeded: true };
  }

  console.log(`[Reflection] Step succeeded.`);
  return { success: true };
}

module.exports = { runReflection };
