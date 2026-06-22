/**
 * Planner Module (Cognitive Split: Thinker & Actor)
 * Thinker: Analyzes context and reasons about the next step.
 * Actor: Translates reasoning into strict JSON tool executions.
 */

const { callLLM } = require("./llmClient");
const { THINKER_SYSTEM_PROMPT, ACTOR_SYSTEM_PROMPT } = require("../rules/prompts");
const { buildMinimalContext } = require("./contextManager");
const { z } = require("zod");

// Define strict Actor schema
const ToolCallSchema = z.object({
  tool: z.string(),
  input: z.record(z.any())
});
const ActorResponseSchema = z.array(ToolCallSchema);

async function runThinker(state, args) {
  const { onStatus, signal } = args;
  if (onStatus) onStatus("🧠 Thinker: Analyzing situation...");

  const minContext = buildMinimalContext(state);
  
  // Format history
  const historyText = minContext.lastActions.join("\n");
  
  // Render system prompt
  let systemPrompt = THINKER_SYSTEM_PROMPT
    .replace("{{goal}}", minContext.goal || "No active goal")
    .replace("{{history}}", historyText || "No previous actions.");

  const messages = [
    {
      role: "user",
      content: "What should we do next? Please output your reasoning."
    }
  ];

  try {
    const res = await callLLM({
      messages,
      system: systemPrompt,
      model: args.model || "gpt-4o",
      provider: args.provider || "openai",
      onChunk: null, // Don't stream thought directly to UI, wait for action
      signal
    });

    if (onStatus) onStatus("💡 Thinker: Plan formulated.");
    return { thought: res.reply, tokenUsage: res.tokenUsage };
  } catch (err) {
    console.error("[Thinker] LLM call failed:", err.message);
    throw new Error(`Thinker failure: ${err.message}`);
  }
}

async function runActor(state, args, thought) {
  const { onStatus, signal } = args;
  if (onStatus) onStatus("🤖 Actor: Generating execution tool calls...");

  const minContext = buildMinimalContext(state);
  
  // Format tools for prompt
  let toolsText = "";
  for (const [toolName, toolDef] of Object.entries(minContext.availableTools)) {
    toolsText += `- "${toolName}": ${toolDef.description}\n  Schema: ${JSON.stringify(toolDef.schema)}\n`;
  }

  const systemPrompt = ACTOR_SYSTEM_PROMPT
    .replace("{{tools}}", toolsText)
    .replace("{{thought}}", thought || "Proceed with goal.");

  const messages = [
    {
      role: "user",
      content: "Based on the Thinker's reasoning, provide the JSON array of tool calls. Return ONLY valid JSON."
    }
  ];

  let rawReply = "";
  let tokenUsage = null;

  // Attempt generation with 1 retry on Zod validation failure
  let attempts = 0;
  const maxAttempts = 2;
  
  while (attempts < maxAttempts) {
    attempts++;
    try {
      const res = await callLLM({
        messages,
        system: systemPrompt,
        model: args.model || "gpt-4o",
        provider: args.provider || "openai",
        onChunk: null,
        signal
      });
      
      rawReply = res.reply;
      tokenUsage = res.tokenUsage || tokenUsage;

      // Extract JSON array
      let cleanJson = rawReply.replace(/```json/g, "").replace(/```/g, "").trim();
      const startIdx = cleanJson.indexOf("[");
      const endIdx = cleanJson.lastIndexOf("]");
      
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      } else {
        throw new Error("No JSON array found in Actor output.");
      }

      // Parse and Validate
      const parsedRaw = JSON.parse(cleanJson);
      const validationResult = ActorResponseSchema.safeParse(parsedRaw);
      
      if (!validationResult.success) {
        throw new Error(`Zod Schema Validation Failed: ${validationResult.error.message}`);
      }
      
      // Success
      if (onStatus) onStatus("✅ Actor: Execution plan ready.");
      return { action: validationResult.data, tokenUsage };

    } catch (err) {
      console.warn(`[Actor] Parse/Validation failed on attempt ${attempts}: ${err.message}`);
      if (attempts < maxAttempts) {
        if (onStatus) onStatus("⚠️ Actor: Invalid JSON generated. Retrying repair...");
        messages.push({ role: "assistant", content: rawReply });
        messages.push({ 
          role: "user", 
          content: `Your previous output failed validation with error: ${err.message}\nPlease fix it and output ONLY a valid JSON array matching the schema.` 
        });
      } else {
        console.error("[Actor] Hard failure. Could not generate valid tool calls.");
        throw new Error(`Actor JSON validation failed permanently: ${err.message}`);
      }
    }
  }
}

module.exports = { runThinker, runActor };
