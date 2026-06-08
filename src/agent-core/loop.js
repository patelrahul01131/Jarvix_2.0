/**
 * Agent Core Loop
 * Manages the state machine loop for autonomous task execution.
 */

const { STATES, transition } = require("./state-machine");
const { runPlanner } = require("./planner");
const { runExecutor } = require("./executor");
const { runReflection } = require("./reflection");
const { INTENT_CLASSIFIER_PROMPT } = require("../rules/prompts");

const { callLLM } = require("./llmClient");
const { StateGraph, END, START, Annotation } = require("@langchain/langgraph");

const AgentState = Annotation.Root({
  goal: Annotation(),
  args: Annotation(),
  errors: Annotation(),
  workingMemory: Annotation(),
  taskMemory: Annotation(),
  failureMemory: Annotation(),
  episodicMemory: Annotation(),
  recentMessages: Annotation(),
  lastResult: Annotation(),
  attempts: Annotation(),
  action: Annotation(),
  status: Annotation(),
  autoEdits: Annotation(),
});

async function classifyIntent(goal, args) {
  if (!goal)
    return {
      intent: "CHAT",
      execution_mode: "chat",
      complexity: 0,
      requires_planning: false,
    };

  const text = goal.trim().toLowerCase();
  const isShort = text.split(/\s+/).length < 20;

  // Extremely basic fast-path for pure greetings to save LLM calls
  if (
    /^(hi|hello|hey|gm|good morning|today is my birthday|i feel)/i.test(text) &&
    isShort
  ) {
    return {
      intent: "CHAT",
      execution_mode: "chat",
      complexity: 10,
      requires_planning: false,
    };
  }

  const system = INTENT_CLASSIFIER_PROMPT;

  try {
    let rawOutput = "";
    await callLLM({
      messages: [{ role: "user", content: goal }],
      system,
      model: args.model,
      provider: args.provider,
      onChunk: (chunk) => {
        rawOutput += chunk;
      },
    });

    const cleanJson = rawOutput
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    const result = JSON.parse(cleanJson);
    return {
      intent: result.intent || "CODE_MODIFICATION",
      execution_mode: result.execution_mode || "agent",
      complexity: result.complexity || 50,
      requires_context: result.requires_context ?? true,
      requires_planning: result.requires_planning ?? true,
      requires_tools: result.requires_tools ?? true,
      requires_memory: result.requires_memory ?? true,
      requires_web: result.requires_web ?? false,
      requires_reflection: result.requires_reflection ?? true,
      estimated_files: result.estimated_files || 1,
    };
  } catch (err) {
    console.warn(
      "[Agent OS] LLM Intent classification failed, falling back to heuristics.",
      err.message,
    );
    const isCode =
      !isShort ||
      text.includes(".js") ||
      text.includes("code") ||
      /^(build|fix|add|update|write|make)/.test(text);
    return {
      intent: isCode ? "CODE_MODIFICATION" : "CHAT",
      execution_mode: isCode ? "agent" : "chat",
      complexity: isCode ? 60 : 10,
      requires_planning: isCode,
    };
  }
}

async function runAgentLoop(goal, args) {
  let result = { success: false, status: "UNKNOWN" };

  let session = require("../memory/shortTerm").getSession(args.sessionId);
  let loadedAction = null;

  if (args.executePlan && session) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      if (
        msg.role === "assistant" &&
        msg.planStatus === "approved" &&
        msg.planData
      ) {
        loadedAction = msg.planData[0];
        break;
      }
    }
  }

  const initialContext = {
    goal:
      goal || session?.messages.find((m) => m.role === "user")?.content || "",
    args: args,
    errors: [],
    workingMemory: session?.workingMemory || { activeFiles: [] },
    taskMemory: session?.taskMemory || {
      completed: [],
      active: [],
      pending: [],
    },
    failureMemory: session?.failureMemory || [],
    episodicMemory: session?.episodicMemory || [],
    recentMessages: session
      ? session.messages.slice(-50).map((m) => `${m.role}: ${m.content}`)
      : [],
    lastResult: null,
    attempts: 0,
    action: null,
    status: "UNKNOWN",
    autoEdits: 0,
  };

  // If we are resuming from an approved plan, execute it first
  if (loadedAction) {
    if (args.onStatus) args.onStatus(`⚙️ Executing Approved Action`);
    const execRes = await runExecutor(loadedAction, initialContext, args);
    const observation = `system: Executed ${loadedAction.tool}. Result: ${execRes.stdout || execRes.stderr}`;
    initialContext.recentMessages.push(observation);
    session.messages.push({ role: "system", content: observation });
    require("../memory/shortTerm").saveSession(args.sessionId, session);
  }

  // ─── LangGraph Nodes ────────────────────────────────────────────────────────
  async function planNode(state) {
    let attempts = (state.attempts || 0) + 1;
    if (state.args.onStatus)
      state.args.onStatus(`🧠 Thinking... (Step ${attempts})`);

    let action;
    try {
      action = await runPlanner(state, state.args);
    } catch (err) {
      console.error("[Agent OS] Planner error:", err);
      if (state.args.onChunk)
        state.args.onChunk(`\n⚠️ **Error:** ${err.message}\n`);
      return { status: "FAILED", attempts };
    }

    if (!action || !action.tool) {
      return { status: "FAILED", attempts };
    }

    // --- State Reducer: Apply task_update to memory ---
    if (action.task_update) {
      if (action.task_update.completed)
        state.taskMemory.completed = action.task_update.completed;
      if (action.task_update.active)
        state.taskMemory.active = action.task_update.active;
      if (action.task_update.pending)
        state.taskMemory.pending = action.task_update.pending;
      if (action.task_update.activeFiles)
        state.workingMemory.activeFiles = action.task_update.activeFiles;

      let sess = require("../memory/shortTerm").getSession(
        state.args.sessionId,
      );
      if (sess) {
        sess.taskMemory = state.taskMemory;
        sess.workingMemory = state.workingMemory;
        require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
      }
    }
    // --------------------------------------------------

    let tokenMsg = "";
    if (action._tokenUsage) {
      const pt =
        action._tokenUsage.prompt_tokens ||
        action._tokenUsage.promptTokens ||
        action._tokenUsage.promptTokenCount ||
        action._tokenUsage.input_tokens ||
        0;
      const ct =
        action._tokenUsage.completion_tokens ||
        action._tokenUsage.completionTokens ||
        action._tokenUsage.candidatesTokenCount ||
        action._tokenUsage.output_tokens ||
        0;
      tokenMsg = `\n\n---\n⚡ **Tokens:** \`${pt}\` In | \`${ct}\` Out\n`;
    }

    if (action.tool === "response") {
      if (state.args.onChunk)
        state.args.onChunk(`\n${action.input.message}${tokenMsg}\n`);
      return { action, attempts, status: "DONE" };
    }

    // High-risk tools require user approval
    const highRisk = ["fs.writeFile", "fs.editFile", "shell.exec"];
    if (highRisk.includes(action.tool)) {
      const planStr = JSON.stringify([action], null, 2);

      const currentAutoEdits = state.autoEdits || 0;
      const isBigPlan = currentAutoEdits >= 3;

      if (state.args.onChunk && isBigPlan) {
        state.args.onChunk(
          `\n\n<jarvix-plan>\n${planStr}\n</jarvix-plan>${tokenMsg}\n`,
        );
      } else if (state.args.onChunk && !isBigPlan && tokenMsg) {
        state.args.onChunk(tokenMsg);
      }

      let sess = require("../memory/shortTerm").getSession(
        state.args.sessionId,
      );
      if (sess) {
        if (isBigPlan) {
          sess.messages.push({
            role: "assistant",
            content: `Proposed action: ${action.tool}`,
            isPlan: true,
            planData: [action],
            planStatus: "pending",
          });
        } else if (action.tool === "shell.exec") {
          sess.messages.push({
            role: "assistant",
            content: `Proposed command: ${action.input.command}`,
            isPlan: false,
            suggestedCommands: [
              {
                command: action.input.command,
                status: "pending",
              },
            ],
          });
        } else {
          let newCode = "";
          if (action.tool === "fs.writeFile") {
            newCode = action.input.content;
          } else if (action.tool === "fs.editFile") {
            const fs = require("fs");
            const path = require("path");
            const fullPath = path.resolve(
              state.args.workspaceRoot,
              action.input.path,
            );
            if (fs.existsSync(fullPath)) {
              const originalCode = fs.readFileSync(fullPath, "utf-8");
              const lines = originalCode.split("\n");
              const startIdx = action.input.startLine - 1;
              const endIdx = action.input.endLine - 1;
              if (
                startIdx >= 0 &&
                endIdx < lines.length &&
                startIdx <= endIdx
              ) {
                newCode = [
                  ...lines.slice(0, startIdx),
                  action.input.replace,
                  ...lines.slice(endIdx + 1),
                ].join("\n");
              } else {
                newCode = originalCode;
              }
            }
          }

          sess.messages.push({
            role: "assistant",
            content: `Proposed file edit: ${action.input.path}`,
            isPlan: false,
            fileEdits: [
              {
                filePath: action.input.path,
                newCode: newCode,
                originalCode: null,
                isNew: action.tool === "fs.writeFile",
                status: "pending",
              },
            ],
          });
        }
        require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
      }
      return {
        action,
        attempts,
        status: "AWAITING_APPROVAL",
        autoEdits: currentAutoEdits + 1,
      };
    }

    if (state.args.onChunk && tokenMsg) {
      state.args.onChunk(tokenMsg);
    }
    return { action, attempts };
  }

  async function executeNode(state) {
    if (state.args.onStatus) {
      const tool = state.action.tool;
      const targetPath = state.action.input?.path
        ? ` ${state.action.input.path.replace(/\\/g, "/").split("/").pop()}`
        : "";
      if (tool === "fs.readFile") state.args.onStatus(`[READING]${targetPath}`);
      else if (tool === "fs.writeFile" || tool === "fs.editFile")
        state.args.onStatus(`[EDITING]${targetPath}`);
      else if (tool === "grep_search")
        state.args.onStatus(`[SCANNING] Codebase...`);
      else if (tool === "shell.exec")
        state.args.onStatus(`[EXECUTING] Terminal Command`);
      else if (tool === "list_dir") state.args.onStatus(`[LISTING] Directory`);
      else state.args.onStatus(`[RUNNING] ${tool}`);
    }

    const execRes = await runExecutor(state.action, state, state.args);
    const observation = `system: Executed ${state.action.tool}. Result: ${execRes.stdout || execRes.stderr}`;

    const newMessages = [...(state.recentMessages || []), observation].slice(
      -50,
    );

    let sess = require("../memory/shortTerm").getSession(state.args.sessionId);
    if (sess) {
      sess.messages.push({ role: "system", content: observation });

      // --- Failure Memory Trapping ---
      if (execRes.success === false) {
        const failureEntry = {
          tool: state.action.tool,
          input: state.action.input,
          error: execRes.stderr || "Unknown execution error",
        };
        state.failureMemory.push(failureEntry);
        sess.failureMemory = state.failureMemory;
      }
      // -------------------------------

      require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
    }

    return { recentMessages: newMessages, failureMemory: state.failureMemory };
  }

  // ─── LangGraph Edges ────────────────────────────────────────────────────────
  function shouldContinue(state) {
    if (
      state.status === "FAILED" ||
      state.status === "DONE" ||
      state.status === "AWAITING_APPROVAL"
    ) {
      return END;
    }
    const maxAttempts = 15;
    if (state.attempts >= maxAttempts) {
      if (state.args.onChunk)
        state.args.onChunk(`\n⚠️ **Jarvix reached maximum iterations.**\n`);
      return END;
    }
    return "executeNode";
  }

  // ─── Compile and Invoke Graph ─────────────────────────────────────────────
  const workflow = new StateGraph(AgentState)
    .addNode("planNode", planNode)
    .addNode("executeNode", executeNode)
    .addEdge(START, "planNode")
    .addConditionalEdges("planNode", shouldContinue)
    .addEdge("executeNode", "planNode");

  const app = workflow.compile();

  let finalState;
  try {
    finalState = await app.invoke(initialContext);
  } catch (err) {
    console.error("[Agent OS] LangGraph execution error:", err);
    return { status: "FAILED", context: initialContext };
  }

  let finalStatus = finalState.status;
  if (
    finalState.attempts >= 15 &&
    finalStatus !== "DONE" &&
    finalStatus !== "AWAITING_APPROVAL"
  ) {
    finalStatus = "FAILED";
  }

  return { status: finalStatus, context: finalState };
}

// Shim for extension.js to connect the UI to the new loop
async function askAgent(args) {
  const { question, onStatus, onChunk, sessionId } = args;

  const shortTerm = require("../memory/shortTerm");
  let session = shortTerm.getSession(sessionId);

  if (!session) {
    session = {
      id: sessionId,
      messages: [],
      state: "idle",
      taskMemory: { completed: [], active: [], pending: [] },
      workingMemory: { activeFiles: [] },
      failureMemory: [],
    };
  } else {
    if (!session.taskMemory)
      session.taskMemory = { completed: [], active: [], pending: [] };
    if (!session.workingMemory) session.workingMemory = { activeFiles: [] };
    if (!session.failureMemory) session.failureMemory = [];
  }

  if (question && !args.executePlan) {
    session.messages.push({ role: "user", content: question });
  }

  // We don't push empty assistant message anymore since we might stream <jarvix-plan>
  // Actually the UI expects the streaming message to be the last one
  session.messages.push({ role: "assistant", content: "", streaming: true });
  shortTerm.saveSession(sessionId, session);

  if (session.messages.length > 15) {
    if (onStatus) onStatus("🗜️ Compressing older memory...");
    await shortTerm.compressSession(sessionId);
  }

  let fullResponse = "";
  const patchedOnChunk = (text) => {
    fullResponse += text;
    if (onChunk) onChunk(text);
  };

  const loopArgs = {
    ...args,
    onChunk: patchedOnChunk,
  };

  let classification = null;
  if (!args.executePlan && question) {
    if (onStatus) onStatus("🧠 Analyzing intent...");
    classification = await classifyIntent(question, loopArgs);
    if (onStatus)
      onStatus(
        `🧭 Execution Mode: ${classification.execution_mode.toUpperCase()} (Complexity: ${classification.complexity})`,
      );
  }

  let result;

  if (
    classification &&
    (classification.execution_mode === "chat" ||
      classification.execution_mode === "qa")
  ) {
    if (onStatus) onStatus("💬 Generating fast response...");
    try {
      const historyCtx = session.messages
        .slice(-10)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      const messages = [
        {
          role: "user",
          content: `Context:\n${historyCtx}\n\nQuestion:\n${question}`,
        },
      ];
      await callLLM({
        messages,
        system:
          "You are Jarvix, an advanced AI programming assistant. Provide a helpful, clear, and concise answer to the user's question without trying to execute code.",
        model: args.model,
        provider: args.provider,
        onChunk: patchedOnChunk,
      });
      result = { status: "DONE", context: null };
    } catch (err) {
      result = { status: "FAILED", context: null };
      patchedOnChunk(`\nError: ${err.message}\n`);
    }
  } else {
    if (onStatus) onStatus("🧠 Initializing Agent OS...");
    result = await runAgentLoop(question, loopArgs);
  }

  const updatedSession = shortTerm.getSession(sessionId);
  if (updatedSession) {
    // Find the last assistant message, as system messages might have been appended during the loop
    const lastAssistantMsg = [...updatedSession.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    if (lastAssistantMsg) {
      let finalContent = fullResponse;
      if (
        result.status === "AWAITING_APPROVAL" &&
        finalContent.includes("<jarvix-plan>")
      ) {
        lastAssistantMsg.isPlan = true;
        lastAssistantMsg.planStatus = "pending";

        // Extract the JSON plan and store it natively on the message object
        const match = finalContent.match(
          /<jarvix-plan>([\s\S]*?)<\/jarvix-plan>/,
        );
        if (match) {
          try {
            lastAssistantMsg.planData = JSON.parse(match[1]);
          } catch (e) {}
        }

        // Remove the raw tags from the text so the user doesn't see it
        finalContent = finalContent
          .replace(/<jarvix-plan>[\s\S]*?<\/jarvix-plan>/, "")
          .trim();
      }
      lastAssistantMsg.content = finalContent;
      lastAssistantMsg.streaming = false;
    }
    shortTerm.saveSession(sessionId, updatedSession);
  }

  return result;
}

module.exports = { runAgentLoop, askAgent };
