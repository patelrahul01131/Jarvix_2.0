/**
 * Planner Module (Cognitive Split: Thinker & Actor)
 * Thinker: Analyzes context and reasons about the next step.
 * Actor: Translates reasoning into strict JSON tool executions.
 */

const { callLLM } = require("./llmClient");
const {
  THINKER_SYSTEM_PROMPT,
  ACTOR_SYSTEM_PROMPT,
} = require("../rules/prompts");
const { buildThinkerContext } = require("./context_builder");
const { z } = require("zod");

// Define strict Actor schema
const SkillCallSchema = z.object({
  skill: z.string(),
  input: z.record(z.any()),
});
const ActorResponseSchema = z.array(SkillCallSchema);

async function runThinker(state, args) {
  const { onStatus, signal } = args;
  if (onStatus) onStatus("🧠 Thinker: Analyzing situation...");

  const minContext = await buildThinkerContext(state, args);

  // Format history
  const historyText = minContext.recentMessages.join("\n");

  // ─── Episodic context from attentive memory ───────────────────────────────
  // state.episodicContext is populated by thinkerNode in loop.js via getAttentiveMemory().
  // Tells the LLM what happened in compressed past sessions most relevant to this goal.
  const episodicSection = state.episodicContext
    ? `\n\n## Relevant Past Episodes (from episodic memory)\n${state.episodicContext}\n`
    : "";

  // ─── Compression awareness ────────────────────────────────────────────────
  // If beliefs show a recent compression, the LLM should know the full raw
  // history is no longer in context — only summaries exist.
  const compressionBelief = args.memoryManager
    ? args.memoryManager.getBelief?.("last_compression")
    : null;
  const compressionNote = compressionBelief
    ? `\n> ⚠️ Note: Conversation history was compressed at ${new Date(compressionBelief.currentValue).toLocaleTimeString()}. Past details exist only as episode summaries above.\n`
    : "";

  // ─── Format new context elements ──────────────────────────────────────────
  let beliefsText = "No active beliefs.";
  if (minContext.beliefs && minContext.beliefs.length > 0) {
    beliefsText = minContext.beliefs
      .filter(b => b.confidence > 0.3)
      .map(b => `- [${(b.confidence * 100).toFixed(0)}% sure] ${b.key}: ${b.value}`)
      .join('\n');
  } else if (args.memoryManager && typeof args.memoryManager.getAllBeliefs === 'function') {
    // Fallback directly to memory manager if context builder missed it
    const allBeliefs = args.memoryManager.getAllBeliefs();
    if (allBeliefs.length > 0) {
      beliefsText = allBeliefs
        .filter(b => b.confidence > 0.3)
        .map(b => `- [${(b.confidence * 100).toFixed(0)}% sure] ${b.key}: ${b.value}`)
        .join('\n');
    }
  }

  let observationsText = "No recent observations.";
  if (minContext.observations && minContext.observations.length > 0) {
    observationsText = minContext.observations
      .map(o => `- [${o.source}] ${o.fact}`)
      .join('\n');
  }

  let workspaceStateText = "Unknown architecture.";
  if (minContext.workspaceState && Object.keys(minContext.workspaceState).length > 1) {
    workspaceStateText = JSON.stringify(minContext.workspaceState, null, 2);
  }

  // Render system prompt
  let systemPrompt = THINKER_SYSTEM_PROMPT.replace(
    "{{goal}}",
    minContext.goal || "No active goal",
  )
    .replace("{{history}}", historyText || "No previous actions.")
    .replace("{{currentIntent}}", JSON.stringify(minContext.currentIntent || {}, null, 2))
    .replace("{{workingMemory}}", JSON.stringify(minContext.workingMemory || {}, null, 2))
    .replace("{{plan}}", JSON.stringify(minContext.plan || [], null, 2))
    .replace("{{contextFeed}}", JSON.stringify(minContext.contextFeed || [], null, 2));

  // Note: episodic context is now naturally fed via the contextFeed!
  // No need to append it manually anymore.

  const messages = [
    {
      role: "user",
      content: "What should we do next? Please output your reasoning.",
    },
  ];

  try {
    const res = await callLLM({
      messages,
      system: systemPrompt,
      model: args.model || "gemini-2.5-pro",
      provider: args.provider || "gemini",
      onChunk: null, // Don't stream thought directly to UI, wait for action
      signal,
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
  if (onStatus) onStatus("🤖 Actor: Generating execution skill calls...");

  const minContext = await buildThinkerContext(state, args);

  // Format tools for prompt
  let toolsText = "";
  for (const [toolName, toolDef] of Object.entries(minContext.availableTools)) {
    toolsText += `- "${toolName}": ${toolDef.description}\n  Schema: ${JSON.stringify(toolDef.schema)}\n`;
  }

  const systemPrompt = ACTOR_SYSTEM_PROMPT.replace(
    "{{tools}}",
    toolsText,
  ).replace("{{thought}}", thought || "Proceed with goal.");

  const messages = [
    {
      role: "user",
      content:
        "Based on the Thinker's reasoning, provide the JSON array of skill calls. Return ONLY valid JSON.",
    },
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
        model: args.model || "gemini-2.5-pro",
        provider: args.provider || "gemini",
        onChunk: null,
        signal,
      });

      rawReply = res.reply;
      tokenUsage = res.tokenUsage || tokenUsage;

      let cleanJson = rawReply.trim();
      // Remove markdown code blocks if present
      cleanJson = cleanJson
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

      let startIndex = cleanJson.indexOf("[");
      if (startIndex !== -1) {
        let bracketCount = 0;
        let endIndex = -1;
        for (let i = startIndex; i < cleanJson.length; i++) {
          if (cleanJson[i] === "[") bracketCount++;
          else if (cleanJson[i] === "]") bracketCount--;

          if (bracketCount === 0) {
            endIndex = i;
            break;
          }
        }
        if (endIndex !== -1) {
          cleanJson = cleanJson.substring(startIndex, endIndex + 1);
        } else {
          throw new Error(
            "No closing bracket found for JSON array in Actor output.",
          );
        }
      } else {
        throw new Error("No JSON array found in Actor output.");
      }

      // Parse and Validate
      const parsedRaw = JSON.parse(cleanJson);
      const validationResult = ActorResponseSchema.safeParse(parsedRaw);

      if (!validationResult.success) {
        throw new Error(
          `Zod Schema Validation Failed: ${validationResult.error.message}`,
        );
      }

      // Success
      if (onStatus) onStatus("✅ Actor: Execution plan ready.");
      return { action: validationResult.data, tokenUsage };
    } catch (err) {
      console.warn(
        `[Actor] Parse/Validation failed on attempt ${attempts}: ${err.message}`,
      );
      if (attempts < maxAttempts) {
        if (onStatus)
          onStatus("⚠️ Actor: Invalid JSON generated. Retrying repair...");
        messages.push({ role: "assistant", content: rawReply });
        messages.push({
          role: "user",
          content: `Your previous output failed validation with error: ${err.message}\nPlease fix it and output ONLY a valid JSON array matching the schema.`,
        });
      } else {
        console.error(
          "[Actor] Hard failure. Could not generate valid skill calls.",
        );
        throw new Error(
          `Failed to parse Actor output as valid JSON after multiple attempts. The agent loop cannot proceed. Error: ${err.message}`,
        );
      }
    }
  }
}

module.exports = { runThinker, runActor };
