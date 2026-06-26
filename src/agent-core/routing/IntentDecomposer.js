const { callLLM } = require("../llmClient");
const { extractJson } = require("../../core/utils");

class IntentDecomposer {
  async splitTasks(text, semanticRouter, session, args) {
    const messages = [{ role: "user", content: text }];
    const system = `You are a Task Decomposer. If the user input contains multiple distinct requests or statements (e.g. stating a fact like "my name is X" + asking a question, or two different commands), split them into an array of strings. If it's a single request, return an array with just one string. Return ONLY JSON matching schema: { "tasks": ["part 1", "part 2"] }`;
    
    try {
      const { reply } = await callLLM({
        messages,
        system,
        model: args?.model || 'gemini-2.5-pro',
        provider: args?.provider || 'gemini',
        onChunk: null,
        signal: null
      });
      
      const parsed = extractJson(reply);
      if (parsed && parsed.tasks && parsed.tasks.length > 1) {
        const subTasks = [];
        for (const part of parsed.tasks) {
          const classification = await semanticRouter.classify(part);
          if (classification) {
             subTasks.push({ text: part, ...classification });
          }
        }
        return subTasks;
      }
    } catch(err) {
      console.warn("[IntentDecomposer] LLM failed to split tasks, falling back to naive split:", err.message);
    }
    
    // Fallback naive split
    const splitTokens = [' and then ', ' and also ', ' and ', ' then '];
    for (const token of splitTokens) {
      if (text.toLowerCase().includes(token)) {
        const parts = text.split(new RegExp(token, 'i')).map(s => s.trim()).filter(s => s.length > 3);
        if (parts.length > 1) {
          const subTasks = [];
          for (const part of parts) {
            const classification = await semanticRouter.classify(part);
            if (classification) {
               subTasks.push({ text: part, ...classification });
            }
          }
          return subTasks;
        }
      }
    }
    return null;
  }
}

module.exports = { IntentDecomposer };
