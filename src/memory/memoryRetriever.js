const { callLLM } = require("../agent-core/llmClient");

/**
 * Memory Retriever
 * Responsible for selecting ONLY the relevant parts of the long-term memory
 * to inject into the planner's context, avoiding context bloat.
 */
async function retrieveContext(goal, userProfile, args = {}) {
  // Always include session instructions as they are temporary and highly relevant
  const injected = {
    permanent: { user: {}, projects: {}, preferences: {}, relationships: {} },
    session: userProfile?.session || { instructions: [], temporary_context: [] }
  };

  if (!userProfile || !userProfile.permanent) {
    return injected;
  }
  
  // 1. Flatten keys for the LLM to select from
  const flatKeys = [];
  for (const cat of Object.keys(userProfile.permanent)) {
    for (const key of Object.keys(userProfile.permanent[cat])) {
      flatKeys.push(`permanent.${cat}.${key}`);
    }
  }

  // If memory is empty, return early
  if (flatKeys.length === 0) {
    return injected;
  }

  const system = `You are the Memory Retrieval module. 
Your job is to select the EXACT keys from the User Profile that are relevant to answering the user's goal.

Retrieval Priority Rules:
1. Exact key match (e.g., asked for RAM -> select permanent.user.laptop_ram)
2. Semantic similarity (e.g., asked about hardware -> select laptop_ram)
3. Category match (e.g., asked for projects -> select all permanent.projects.* keys)
4. DO NOT select keys if the user's goal does not relate to them (e.g., "Explain event loop" -> return empty array).

Available Keys:
${JSON.stringify(flatKeys, null, 2)}

Output STRICT JSON:
{
  "retrieved_keys": ["key1", "key2"]
}`;

  try {
    let rawOutput = "";
    // Using the same provider, ideally a fast model if configured, but default to current
    await callLLM({
      messages: [{ role: "user", content: `Goal: ${goal}` }],
      system,
      model: args.model || "gpt-4o",
      provider: args.provider || "openai",
      signal: args.signal || null,
      onChunk: (c) => { rawOutput += c; }
    });

    let cleanJson = rawOutput.replace(/```json/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleanJson = jsonMatch[0];
    
    const parsed = JSON.parse(cleanJson);
    const retrievedKeys = parsed.retrieved_keys || [];
    
    console.log(`[MemoryRetriever] Extracted keys for goal "${goal}":`, retrievedKeys);

    // 2. Rebuild the structured object with only the selected keys
    let keysAdded = 0;
    for (const key of retrievedKeys) {
      const parts = key.split(".");
      if (parts.length === 3 && parts[0] === "permanent") {
        const cat = parts[1];
        const item = parts[2];
        if (userProfile.permanent[cat] && userProfile.permanent[cat][item]) {
          injected.permanent[cat][item] = userProfile.permanent[cat][item];
          keysAdded++;
        }
      }
    }

    // 3. Fallback logic: If they asked a very broad "Who am I" question and LLM missed it
    if (keysAdded === 0 && (goal.toLowerCase().includes("who am i") || goal.toLowerCase().includes("profile"))) {
      console.log("[MemoryRetriever] Triggered full profile fallback.");
      injected.permanent = userProfile.permanent;
    }

    return injected;
  } catch (e) {
    console.warn("[MemoryRetriever] Retrieval failed, falling back to full memory.", e.message);
    // 4. Ultimate fallback on failure: return full memory
    return userProfile;
  }
}

module.exports = { retrieveContext };
