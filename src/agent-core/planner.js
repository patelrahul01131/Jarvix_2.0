/**
 * Planner Module
 * Responsible for breaking down the goal into actionable steps.
 */

const { callLLM } = require("./llmClient");
const { PLANNER_SYSTEM_PROMPT } = require("../rules/prompts");


async function runPlanner(context, args) {
  const {
    question,
    model,
    provider,
    signal,
    onChunk,
    onStatus,
    explicitFiles,
    workspaceRoot,
    workspaceFiles,
  } = args;

  if (onStatus) onStatus("🧠 Generating implementation plan...");

  try {
    let fileContext = "";
    if (explicitFiles && explicitFiles.length > 0) {
      fileContext +=
        "\n\nAttached Files:\n" +
        explicitFiles
          .map((f) => `File: ${f.name}\n${f.content}`)
          .join("\n---\n");
    }

    let workspaceContext = "";
    if (workspaceFiles && workspaceFiles.length > 0) {
      workspaceContext =
        "\n\nWorkspace Files List:\n" +
        workspaceFiles.map((f) => f.path || f).join("\n");
    }

    let historyContext = "";
    if (context.episodicMemory && context.episodicMemory.length > 0) {
      historyContext += "\n\nPast Session Summaries:\n" + context.episodicMemory.map(e => e.summary).join("\n");
    }
    if (context.recentMessages && context.recentMessages.length > 0) {
      historyContext +=
        "\n\nRecent Conversation History:\n" + context.recentMessages.join("\n");
    }

    let memoryContext = "";
    if (context.taskMemory) {
      memoryContext += "\n\nTask Memory:\n" + JSON.stringify(context.taskMemory, null, 2);
    }
    if (context.workingMemory && context.workingMemory.activeFiles) {
      memoryContext += "\n\nWorking Memory (Active Files):\n";
      const fs = require("fs");
      const path = require("path");
      const activeFilesList = Array.isArray(context.workingMemory.activeFiles) ? context.workingMemory.activeFiles : [];
      activeFilesList.forEach(relPath => {
         if (typeof relPath !== "string") return;
         try {
           const fullPath = path.resolve(args.workspaceRoot, relPath);
           if (fs.existsSync(fullPath)) {
             const code = fs.readFileSync(fullPath, "utf8");
             memoryContext += `\n--- ${relPath} ---\n${code.substring(0, 1000)}${code.length > 1000 ? "\n... (truncated)" : ""}\n`;
           } else {
             memoryContext += `\n--- ${relPath} (File not found) ---\n`;
           }
         } catch(e) {
           memoryContext += `\n--- ${relPath} (Error reading file) ---\n`;
         }
      });
    }
    if (context.failureMemory && context.failureMemory.length > 0) {
      memoryContext += "\n\nFailure Memory (Avoid repeating these mistakes):\n" + JSON.stringify(context.failureMemory, null, 2);
    }

    // --- Upgrade: Semantic Vector Search Retrieval (RAG) ---
    let semanticContext = "";
    try {
      const { semanticSearch } = require("../indexer/RepositoryIndexer");
      if (onStatus) onStatus("🔍 Performing semantic codebase search...");
      const ragResults = await semanticSearch(context.goal, { limit: 5 });
      if (ragResults.status === "success" && ragResults.results.length > 0) {
        semanticContext = "\n\nSemantic Context (Relevant Code Skeletons):\n";
        ragResults.results.forEach((res, i) => {
          const contentToInject = res.skeleton && res.skeleton.trim() !== '' ? res.skeleton : res.code;
          semanticContext += `\n--- [${i + 1}] ${res.filePath} (${res.chunkType}: ${res.name}) ---\n${contentToInject}\n`;
        });
      }
    } catch (ragErr) {
      console.warn("[Planner] RAG retrieval failed:", ragErr.message);
    }

    const messages = [
      {
        role: "user",
        content: `WORKSPACE ROOT: ${workspaceRoot || "Unknown"}${memoryContext}${historyContext}${semanticContext}\n\nGOAL: ${context.goal}${fileContext}\n\nPlease generate the next action.`,
      },
    ];

    let attemptModels = [
      { provider: args.provider, model: args.model },
      { provider: "gemini", model: "gemini-1.5-flash" },
      { provider: "openrouter", model: "qwen/qwen-2.5-coder-32b-instruct:free" },
      { provider: "openrouter", model: "google/gemini-2.0-flash-lite-preview-02-05:free" },
      { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
    ];

    let reply = null;
    let lastErr = null;
    let tokenUsage = null;

    if (onStatus) onStatus("⚙️ Consulting LLM for next action...");

    for (const m of attemptModels) {
      if (!m.provider || !m.model) continue;
      try {
        const res = await callLLM({
          messages,
          system: PLANNER_SYSTEM_PROMPT,
          model: m.model,
          provider: m.provider,
          onChunk: null, // Don't stream JSON bracket generation to user UI
          signal,
        });
        reply = res.reply;
        tokenUsage = res.tokenUsage;
        console.log(
          `[Planner] Successfully generated plan using ${m.provider}/${m.model}`,
        );
        break; // Success!
      } catch (err) {
        lastErr = err;
        console.warn(
          `[Planner] LLM call failed for ${m.provider}/${m.model}: ${err.message}. Retrying fallback...`,
        );
      }
    }

    if (!reply && lastErr) {
      throw lastErr;
    }

    // Extract JSON object from LLM reply securely
    let cleanJson = reply.replace(/```json/g, "").replace(/```/g, "").trim();
    const startIdx = cleanJson.indexOf('{');
    const endIdx = cleanJson.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      cleanJson = cleanJson.substring(startIdx, endIdx + 1);
      
      // Try native parsing first (in case it is perfectly valid)
      try {
        const action = JSON.parse(cleanJson);
        action._tokenUsage = tokenUsage;
        return action;
      } catch (nativeParseErr) {
        // Fallback: Sanitize unescaped control characters in JSON strings if any
        let fixedJson = "";
        let inString = false;
      let isEscaped = false;
      for (let i = 0; i < cleanJson.length; i++) {
        const char = cleanJson[i];
        if (char === '"' && !isEscaped) {
          inString = !inString;
          fixedJson += char;
        } else if (char === "\\" && !isEscaped) {
          isEscaped = true;
          fixedJson += char;
        } else {
          if (isEscaped) {
            // Validate JSON escape sequence. If invalid, double-escape the backslash.
            if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'].includes(char)) {
              fixedJson += "\\";
            }
            fixedJson += char;
            isEscaped = false;
          } else {
            if (inString && char === "\n") fixedJson += "\\n";
            else if (inString && char === "\r") fixedJson += "\\r";
            else if (inString && char === "\t") fixedJson += "\\t";
            else fixedJson += char;
          }
        }
      }
      
        try {
          const action = JSON.parse(fixedJson);
          action._tokenUsage = tokenUsage;
          return action;
        } catch (parseErr) {
          // Final fallback for completely broken JSON (e.g., unescaped quotes inside strings)
          // Attempt a regex repair to escape unescaped inner quotes in string values.
          try {
            // Find all string values and escape inner quotes
            let repairedJson = cleanJson.replace(/:\s*"([^]*?)"(\s*[,}])/g, (match, p1, p2) => {
               // Only escape quotes that are not already escaped by a backslash
               const escaped = p1.replace(/(?<!\\)"/g, '\\"');
               return ': "' + escaped + '"' + p2;
            });
            // Try parsing one last time
            const action = JSON.parse(repairedJson);
            action._tokenUsage = tokenUsage;
            return action;
          } catch (repairErr) {
            if (onStatus) onStatus("❌ Fatal: LLM produced malformed JSON.");
            console.error("JSON Parse Error:", parseErr, "Payload:", fixedJson);
            throw new Error(`LLM generated invalid JSON format. ${parseErr.message}`);
          }
        }
      }
    } else {
      if (onStatus) onStatus("❌ Fatal: LLM response did not contain JSON.");
      throw new Error("No JSON object found in LLM response:\n" + reply);
    }
  } catch (err) {
    console.error("[Planner] Failed to generate plan:", err.message);
    const isRateLimit = /429|quota|rate limit/i.test(err.message);
    const userMsg = isRateLimit
      ? "⚠️ **Jarvix is experiencing high load or rate limits. Please try again shortly.**"
      : "⚠️ **Could not generate a plan due to a connection issue. Please try again.**";

    if (onChunk) onChunk(`\n${userMsg}\n\n`);
    return [];
  }
}

module.exports = { runPlanner };
