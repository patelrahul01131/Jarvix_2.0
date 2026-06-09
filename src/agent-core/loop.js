/**
 * Agent Core Loop
 * Manages the state machine loop for autonomous task execution.
 */

const { STATES, transition } = require("./state-machine");
const { runPlanner } = require("./planner");
const { runExecutor } = require("./executor");
const { runReflection } = require("./reflection");
const { INTENT_CLASSIFIER_PROMPT } = require("../rules/prompts");
const { getProjectKnowledge } = require("./knowledge");

const { callLLM } = require("./llmClient");
const { StateGraph, END, START, Annotation } = require("@langchain/langgraph");

const AgentState = Annotation.Root({
  goal: Annotation(),
  args: Annotation(),
  errors: Annotation(),
  truthState: Annotation(),
  beliefState: Annotation(),
  worldModel: Annotation(),
  taskGraph: Annotation(),
  memory: Annotation(),
  currentIntent: Annotation(),
  uncertaintyMap: Annotation(),
  objectiveMetrics: Annotation(),
  executionBudget: Annotation(),
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
  executionLogs: Annotation(),
  currentPhase: Annotation(),
  chunkFailures: Annotation(),
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
      risk_level: result.risk_level || "low",
      needs_rag: result.needs_rag ?? true,
      needs_terminal: result.needs_terminal ?? true,
      context_expansion_needed: result.context_expansion_needed ?? false,
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
      goal.includes(".js") ||
      goal.includes("code") ||
      /^(build|fix|add|update|write|make)/i.test(goal);
    return {
      intent: isCode ? "CODE_MODIFICATION" : "CHAT",
      execution_mode: isCode ? "agent" : "chat",
      complexity: isCode ? 60 : 10,
      requires_planning: isCode,
    };
  }
}

async function normalizeGoal(question, intent, previousGoal, args) {
  const system = `You are the Goal and Fact Extractor.
Extract the user's implicit or explicit goal into a concise, actionable statement (e.g., "Continue JavaScript MCQ session", "Fix bug in auth route").
Compare this to the previous goal: "${previousGoal || "None"}".
If the topic has shifted drastically (e.g. from Coding to Learning, or to a completely unrelated feature), set resetMemory to true. Otherwise, false.

CRITICAL FACT EXTRACTION:
If the user mentions any personal facts (e.g., their name, preferences, skill level, or absolute rules), extract them into the "extractedFacts" object.

Output strictly as JSON:
{
  "goal": "string",
  "resetMemory": boolean,
  "extractedFacts": {
    "name": "string (optional)",
    "preferences": ["string (optional)"],
    "facts": ["string (optional)"]
  }
}`;
  try {
    let rawOutput = "";
    await callLLM({
      messages: [{ role: "user", content: question }],
      system,
      model: args.model,
      provider: args.provider,
      onChunk: (c) => {
        rawOutput += c;
      },
    });
    const cleanJson = rawOutput
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    return { goal: question, resetMemory: false };
  }
}

async function runAgentLoop(goal, args) {
  let result = { success: false, status: "UNKNOWN" };

  let session = require("../memory/shortTerm").getSession(args.sessionId);
  let loadedPlanSteps = null;

  if (args.executePlan && session) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i];
      if (
        msg.role === "assistant" &&
        msg.planStatus === "approved" &&
        msg.planData
      ) {
        loadedPlanSteps = msg.planData;
        break;
      }
    }
  }

  const initialContext = {
    goal:
      goal || session?.messages.find((m) => m.role === "user")?.content || "",
    args: args,
    errors: [],
    truthState: session?.truthState || {},
    beliefState: session?.beliefState || {},
    worldModel: session?.worldModel || {
      files: {},
      symbols: {},
      processes: [],
    },
    taskGraph: session?.taskGraph || { nodes: [], edges: [] },
    memory: session?.memory || { semantic: [], episodic: [] },
    currentIntent: session?.currentIntent || {},
    uncertaintyMap: session?.uncertaintyMap || {},
    objectiveMetrics: session?.objectiveMetrics || {
      goalProgressScore: 0,
      riskScore: 0,
      stabilityScore: 100,
    },
    executionBudget: {
      maxSteps: 15,
      tokensUsed: 0,
      maxTokens: 100000,
      toolCalls: 0,
      maxToolCalls: 20,
    },
    workingMemory: session?.workingMemory || { activeFiles: [] },
    taskMemory: session?.taskMemory || {
      completed: [],
      active: [],
      pending: [],
    },
    userProfile: require("../memory/shortTerm").getLongTermMemory(),
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
    executionLogs:
      session && session.executionLogs ? session.executionLogs : [],
  };

  // If we are resuming from an approved plan, execute all steps sequentially
  if (loadedPlanSteps && loadedPlanSteps.length > 0) {
    if (args.onStatus)
      args.onStatus(
        `⚙️ Executing Approved Plan (${loadedPlanSteps.length} steps)...`,
      );

    for (let i = 0; i < loadedPlanSteps.length; i++) {
      const step = loadedPlanSteps[i];
      if (args.onStatus)
        args.onStatus(
          `⚙️ Step ${i + 1}/${loadedPlanSteps.length}: ${step.action}`,
        );

      try {
        const execRes = await runExecutor(step, initialContext, args);
        const observation = `system: [TOOL_RESULT] Step ${i + 1}/${loadedPlanSteps.length} executed ${step.tool}. Result: ${execRes.stdout || execRes.stderr}`;
        initialContext.recentMessages.push(observation);
        session.messages.push({ role: "system", content: observation });
        require("../memory/shortTerm").saveSession(args.sessionId, session);

        // If there was an error in execution (e.g. terminal command failed), we should break the loop and let LangGraph repair
        if (
          execRes.stderr &&
          execRes.stderr.trim().length > 0 &&
          !execRes.stdout
        ) {
          initialContext.errors.push(`Step ${i + 1} failed: ${execRes.stderr}`);
          break;
        }
      } catch (err) {
        const errObs = `system: [ERROR] Step ${i + 1}/${loadedPlanSteps.length} failed to execute. Error: ${err.message}`;
        initialContext.recentMessages.push(errObs);
        initialContext.errors.push(`Step ${i + 1} failed: ${err.message}`);
        session.messages.push({ role: "system", content: errObs });
        require("../memory/shortTerm").saveSession(args.sessionId, session);
        break; // Stop executing remaining steps
      }
    }
  }

  // ─── LangGraph Nodes ────────────────────────────────────────────────────────
  async function planNode(state) {
    let sess = require("../memory/shortTerm").getSession(state.args.sessionId);
    if (sess) {
      sess.agentStatus = "🟡 Planning";
      require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
    }

    let attempts = (state.attempts || 0) + 1;
    if (state.args.onStatus)
      state.args.onStatus(
        `[${new Date().toLocaleTimeString()}] 🧠 Thinking... (Step ${attempts})`,
      );

    let action;
    try {
      action = await runPlanner(state, state.args);
    } catch (err) {
      console.error("[Agent OS] Planner error:", err);
      if (state.args.onChunk)
        state.args.onChunk(`\n⚠️ **Error:** ${err.message}\n`);
      let sess = require("../memory/shortTerm").getSession(
        state.args.sessionId,
      );
      if (sess) {
        if (!sess.developerTools) sess.developerTools = [];
        sess.developerTools.push({
          type: "error",
          data: { message: err.message },
          timestamp: new Date().toLocaleTimeString(),
        });
        require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
      }
      return { status: "FAILED", attempts };
    }

    if (
      !action ||
      (!action.tool && (!action.steps || action.steps.length === 0))
    ) {
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
      if (action.task_update.current_step)
        state.taskMemory.current_step = action.task_update.current_step;

      let sess = require("../memory/shortTerm").getSession(
        state.args.sessionId,
      );
      if (sess) {
        sess.taskMemory = state.taskMemory;
        sess.workingMemory = state.workingMemory;
        require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
      }
      if (state.args.onState) {
        state.args.onState({
          phase: state.currentPhase || "Planning",
          currentStep: "DAG Updated",
          activeTool: "Planner",
          executionStatus: "PLANNING",
          totalSteps: state.taskMemory.pending?.length || 1,
          budget: state.executionBudget
        });
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
      // We no longer stream tokens to the chat window to prevent context pollution.
      // We will attach it to the session for the Developer Tools panel.
      let sess = require("../memory/shortTerm").getSession(
        state.args.sessionId,
      );
      if (sess) {
        if (!sess.developerTools) sess.developerTools = [];
        sess.developerTools.push({
          type: "tokenUsage",
          data: { prompt_tokens: pt, completion_tokens: ct },
          timestamp: new Date().toLocaleTimeString(),
        });
        require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
      }
    }

    const steps = action.steps || [];
    if (steps.length === 0) {
      if (action.tool) steps.push(action);
    }

    // If the only step is a response, we're done
    if (steps.length === 1 && steps[0].tool === "response") {
      if (state.args.onChunk)
        state.args.onChunk(`\n${steps[0].input.message}\n`);
      return { action, attempts, status: "DONE" };
    }

    // Loop protection: Check if we are doing the exact same thing 3 times in a row
    if (!state.actionHistory) state.actionHistory = [];
    const currentActionStr = JSON.stringify(
      steps.map((s) => ({ tool: s.tool, input: s.input })),
    );
    state.actionHistory.push(currentActionStr);

    if (state.actionHistory.length >= 3) {
      const last3 = state.actionHistory.slice(-3);
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        if (state.args.onStatus)
          state.args.onStatus(
            `[${new Date().toLocaleTimeString()}] ❌ Loop Detected: Agent repeated action 3 times`,
          );
        let sess = require("../memory/shortTerm").getSession(
          state.args.sessionId,
        );
        if (sess) {
          if (!sess.developerTools) sess.developerTools = [];
          sess.developerTools.push({
            type: "error",
            data: { message: "Loop Detected: Agent repeated action 3 times" },
            timestamp: new Date().toLocaleTimeString(),
          });
          require("../memory/shortTerm").saveSession(
            state.args.sessionId,
            sess,
          );
        }
        return { status: "FAILED", attempts };
      }
    }

    // High-risk tools require user approval
    const highRisk = ["fs.writeFile", "fs.editFile", "shell.exec"];
    const hasHighRisk = steps.some((s) => highRisk.includes(s.tool));

    if (hasHighRisk) {
      const currentAutoEdits = state.autoEdits || 0;
      const isBigPlan = steps.length > 1 || currentAutoEdits >= 3;

      let sess = require("../memory/shortTerm").getSession(
        state.args.sessionId,
      );
      if (sess) {
        if (!sess.developerTools) sess.developerTools = [];
        sess.developerTools.push({
          type: "plan",
          data: action,
          timestamp: new Date().toLocaleTimeString(),
        });

        if (isBigPlan) {
          sess.messages.push({
            role: "assistant",
            content: `Proposed implementation plan with ${steps.length} steps.`,
            isPlan: true,
            planData: steps,
            planStatus: "pending",
          });
        } else {
          const s = steps[0];
          if (s.tool === "shell.exec") {
            sess.messages.push({
              role: "assistant",
              content: `Proposed command: ${s.input.command}`,
              isPlan: false,
              suggestedCommands: [
                {
                  command: s.input.command,
                  status: "pending",
                },
              ],
            });
          } else {
            let newCode = "";
            if (s.tool === "fs.writeFile") {
              newCode = s.input.content;
            } else if (s.tool === "fs.editFile") {
              const fs = require("fs");
              const path = require("path");
              const fullPath = path.resolve(
                state.args.workspaceRoot,
                s.input.path,
              );
              if (fs.existsSync(fullPath)) {
                const originalCode = fs.readFileSync(fullPath, "utf-8");
                const lines = originalCode.split("\n");
                const startIdx = s.input.startLine - 1;
                const endIdx = s.input.endLine - 1;
                if (
                  startIdx >= 0 &&
                  endIdx < lines.length &&
                  startIdx <= endIdx
                ) {
                  newCode = [
                    ...lines.slice(0, startIdx),
                    s.input.replace,
                    ...lines.slice(endIdx + 1),
                  ].join("\n");
                } else {
                  newCode = originalCode;
                }
              }
            }

            sess.messages.push({
              role: "assistant",
              content: `Proposed file edit: ${s.input.path}`,
              isPlan: false,
              fileEdits: [
                {
                  filePath: s.input.path,
                  newCode: newCode,
                  originalCode: null,
                  isNew: s.tool === "fs.writeFile",
                  status: "pending",
                },
              ],
            });
          }
        }
        require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
      }
      return {
        action,
        attempts,
        status: "AWAITING_APPROVAL",
        autoEdits: currentAutoEdits + 1,
        actionHistory: state.actionHistory,
      };
    }

    // Save non-high-risk plan to dev tools as well
    let sess2 = require("../memory/shortTerm").getSession(state.args.sessionId);
    if (sess2) {
      if (!sess2.developerTools) sess2.developerTools = [];
      sess2.developerTools.push({
        type: "plan",
        data: action,
        timestamp: new Date().toLocaleTimeString(),
      });
      require("../memory/shortTerm").saveSession(state.args.sessionId, sess2);
    }

    const stepAction =
      action.steps && action.steps.length > 0 ? action.steps[0] : action;
    return { action: stepAction, attempts, actionHistory: state.actionHistory };
  }

  async function executeNode(state) {
    let sess = require("../memory/shortTerm").getSession(state.args.sessionId);
    if (sess) {
      sess.agentStatus = "🔵 Executing";
      require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
    }

    // --- Phase Lock Validator ---
    const stepPhase = state.action.phase;
    let newPhase = state.currentPhase;
    if (!state.currentPhase && stepPhase) {
      newPhase = stepPhase; // Lock into the first proposed phase
    }

    if (newPhase && stepPhase && stepPhase !== newPhase) {
      if (state.args.onStatus)
        state.args.onStatus(
          `❌ Phase Violation: Cannot mix ${stepPhase} with active ${newPhase}.`,
        );
      return {
        status: "REPLAN_NEEDED",
        currentPhase: newPhase,
        recentMessages: [
          ...(state.recentMessages || []),
          `system: [PHASE_VIOLATION] You attempted to plan a step for '${stepPhase}', but the execution engine is currently locked to '${newPhase}'. You must output steps matching the current phase until it is fully completed.`,
        ],
        lastResult: {
          success: false,
          stderr: `PHASE_VIOLATION: Expected ${newPhase}, got ${stepPhase}.`,
        },
      };
    }

    if (state.args.onStatus) {
      const tool = state.action.tool;
      const targetPath = state.action.input?.path
        ? ` ${state.action.input.path.replace(/\\/g, "/").split("/").pop()}`
        : "";
      const t = `[${new Date().toLocaleTimeString()}] `;
      if (tool === "fs.readFile")
        state.args.onStatus(`${t}[READING]${targetPath}`);
      else if (tool === "fs.writeFile" || tool === "fs.editFile")
        state.args.onStatus(`${t}[EDITING]${targetPath}`);
      else if (tool === "grep_search")
        state.args.onStatus(`${t}[SCANNING] Codebase...`);
      else if (tool === "shell.exec")
        state.args.onStatus(`${t}[EXECUTING] Terminal Command`);
      else if (tool === "list_dir")
        state.args.onStatus(`${t}[LISTING] Directory`);
      else state.args.onStatus(`${t}[RUNNING] ${tool}`);
    }

    if (state.args.onState) {
      state.args.onState({
        phase: newPhase || "Planning",
        currentStep: state.action.action || "Executing Step",
        activeTool: state.action.tool,
        executionStatus: "RUNNING",
        totalSteps: state.taskMemory?.pending?.length || 1,
        budget: state.executionBudget
      });
    }

    const execRes = await runExecutor(state.action, state, state.args);
    const observation = `system: [TOOL_RESULT] ${state.action.tool}\nResult:\n${execRes.stdout || execRes.stderr}`;

    if (state.args.onState) {
      state.args.onState({
        phase: newPhase || "Planning",
        currentStep: state.action.action || "Executed Step",
        activeTool: state.action.tool,
        executionStatus: execRes.success !== false ? "SUCCESS" : "FAILED",
        totalSteps: state.taskMemory?.pending?.length || 1,
        budget: state.executionBudget,
        lastResult: execRes.stdout || execRes.stderr
      });
    }

    const newMessages = [...(state.recentMessages || []), observation].slice(
      -50,
    );

    sess = require("../memory/shortTerm").getSession(state.args.sessionId);
    if (sess) {
      sess.messages.push({ role: "system", content: observation });

      // --- Episodic Replay System (Upgraded from Failure Memory) ---
      if (!sess.episodicMemory) sess.episodicMemory = [];
      const traceEntry = {
        timestamp: Date.now(),
        tool: state.action.tool,
        input: state.action.input,
        success: execRes.success !== false,
        summary: `Action: ${state.action.tool}. Result: ${execRes.success !== false ? "SUCCESS" : "FAILED - " + (execRes.stderr || "Unknown error")}`,
        importance: execRes.success !== false ? 30 : 80, // Failures are more important to remember for repair
      };
      sess.episodicMemory.push(traceEntry);

      // Keep legacy failureMemory for fallback compatibility during transition
      if (execRes.success === false) {
        state.failureMemory.push({
          tool: state.action.tool,
          input: state.action.input,
          error: execRes.stderr || "Unknown execution error",
        });
        sess.failureMemory = state.failureMemory;
      }
      // -------------------------------

      require("../memory/shortTerm").saveSession(state.args.sessionId, sess);
    }

    return {
      recentMessages: newMessages,
      failureMemory: state.failureMemory,
      lastResult: execRes,
    };
  }

  async function validateAndReflectNode(state) {
    // 1. Consistency Rule Engine
    // Rule: truthState > beliefState (always)
    // Rule: validated tool output > model assumption
    let updatedTruth = { ...state.truthState };
    let updatedBelief = { ...state.beliefState };
    let mismatchDetected = false;

    // Resolve conflicts by forcing belief to match truth
    for (const key in updatedTruth.files) {
      if (updatedBelief.files && updatedBelief.files[key]) {
        if (
          updatedBelief.files[key].exists !== updatedTruth.files[key].exists
        ) {
          updatedBelief.files[key] = { ...updatedTruth.files[key] };
          mismatchDetected = true;
        }
      }
    }

    let finalStatus = state.status;

    if (state.lastResult && !state.lastResult.success) {
      mismatchDetected = true;
      const { classifyFailure } = require("./reflection");
      const failureType = classifyFailure(state.lastResult.stderr || "");

      if (failureType === "ENVIRONMENT_BLOCKING") {
        if (state.args.onStatus)
          state.args.onStatus(
            `[${new Date().toLocaleTimeString()}] 🛑 BLOCKING ENVIRONMENT ERROR. Halting automation. Manual intervention required.`,
          );
        finalStatus = "AWAITING_APPROVAL"; // Breaks the loop and asks user
        mismatchDetected = false; // We handled it via halt
      } else if (failureType === "ENVIRONMENT_NONBLOCKING") {
        if (state.args.onStatus)
          state.args.onStatus(
            `[${new Date().toLocaleTimeString()}] ⚠️ Non-Blocking Warning. Skipping and prioritizing main goal...`,
          );
        finalStatus = "SUCCESS_NEXT_STEP"; // Skips the error, continues DAG execution
        mismatchDetected = false; // Ignore the mismatch, do not replan
      }
    }

    // --- Chunk Completion Validator ---
    const taskMem = state.taskMemory || {};
    const noPending = !taskMem.pending || taskMem.pending.length === 0;
    const noActive = !taskMem.active || taskMem.active.length === 0;

    let currentFailures = state.chunkFailures || 0;
    if (state.lastResult && state.lastResult.success === false) {
      currentFailures += 1;
    }

    if (
      noPending &&
      noActive &&
      state.currentPhase &&
      finalStatus !== "REPLAN_NEEDED" &&
      finalStatus !== "FAILED"
    ) {
      finalStatus = "CHUNK_COMPLETE";
    }

    // 2. Execution Budget Manager Updates
    let updatedBudget = { ...state.executionBudget };
    if (state.action && state.action.tool) {
      updatedBudget.toolCalls += 1;
    }

    if (mismatchDetected) {
      if (state.args.onStatus)
        state.args.onStatus(
          `[${new Date().toLocaleTimeString()}] ⚠️ Truth vs Belief Mismatch. Triggering Consistency Engine...`,
        );
      finalStatus = "REPLAN_NEEDED";
    }

    return {
      truthState: updatedTruth,
      beliefState: updatedBelief,
      executionBudget: updatedBudget,
      status: finalStatus,
      chunkFailures: currentFailures,
    };
  }

  // ─── LangGraph Edges ────────────────────────────────────────────────────────
  function shouldContinue(state) {
    // 3. Explicit Loop Termination Policy
    if (
      state.status === "FAILED" ||
      state.status === "DONE" ||
      state.status === "AWAITING_APPROVAL" ||
      state.status === "HARD_STOP"
    ) {
      return END;
    }

    if (state.status === "CHECKPOINT_AUTOPAUSE") {
      if (state.args.onStatus)
        state.args.onStatus(
          "⏸️ CHECKPOINT_AUTOPAUSE: Paused for user approval due to warnings or failures.",
        );
      return END; // Returns END to LangGraph, but UI handles as pause.
    }

    const budget = state.executionBudget;

    // --- Execution Chunk State Machine & Adaptive Decay ---
    if (state.status === "CHUNK_COMPLETE") {
      let decay = 1.0;
      if (state.chunkFailures > 3)
        decay = 0.5; // Oscillation
      else if (state.chunkFailures > 1)
        decay = 0.7; // Retry failure
      else if (state.chunkFailures === 1) decay = 0.85; // Soft failure

      const minBudget = Math.floor(100 * 0.3); // Recovery floor: 30%
      budget.maxToolCalls = Math.max(
        Math.floor(budget.maxToolCalls * decay),
        minBudget,
      );
      budget.toolCalls = 0; // Reset for next phase

      if (state.args.onStatus)
        state.args.onStatus(
          `🔵 CONTINUE_AUTONOMOUS: Chunk complete. Advancing to next phase. (Budget modifier: ${decay}x)`,
        );

      return "planNode"; // Automatically loops back to generate next phase
    }

    // Budget Limits (Triggers CHECKPOINT_AUTOPAUSE instead of HARD_STOP)
    if (
      state.attempts >= budget.maxSteps ||
      budget.toolCalls >= budget.maxToolCalls ||
      budget.tokensUsed >= budget.maxTokens
    ) {
      if (state.args.onChunk)
        state.args.onChunk(
          `\n⚠️ **Jarvix Checkpoint: Execution budget limit reached for this chunk.**\n`,
        );
      state.status = "CHECKPOINT_AUTOPAUSE";
      return END;
    }

    // Oscillation / Infinite Loop Detection
    if (state.actionHistory && state.actionHistory.length >= 4) {
      const last4 = state.actionHistory.slice(-4);
      if (last4[0] === last4[2] && last4[1] === last4[3]) {
        if (state.args.onChunk)
          state.args.onChunk(
            `\n⚠️ **Jarvix Checkpoint: Action oscillation detected.**\n`,
          );
        state.status = "CHECKPOINT_AUTOPAUSE";
        return END;
      }
    }

    if (
      state.status === "FAILED_TO_PARSE" ||
      state.status === "REPLAN_NEEDED"
    ) {
      return "planNode";
    }

    return "executeNode";
  }

  // ─── Compile and Invoke Graph ─────────────────────────────────────────────
  const workflow = new StateGraph(AgentState)
    .addNode("planNode", planNode)
    .addNode("executeNode", executeNode)
    .addNode("validateAndReflectNode", validateAndReflectNode)
    .addEdge(START, "planNode")
    .addConditionalEdges("planNode", shouldContinue)
    .addEdge("executeNode", "validateAndReflectNode")
    .addEdge("validateAndReflectNode", "planNode");

  const app = workflow.compile();

  let finalState;
  try {
    finalState = await app.invoke(initialContext, { recursionLimit: 50 });
  } catch (err) {
    console.error("[Agent OS] LangGraph execution error:", err);
    if (initialContext.args && initialContext.args.onChunk) {
      initialContext.args.onChunk(`\n⚠️ **System Error:** ${err.message}\n`);
    }
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
      agentStatus: "🟢 Idle",
      taskMemory: { completed: [], active: [], pending: [], goal: "" },
      workingMemory: { activeFiles: [] },
      failureMemory: [],
      projectKnowledge: getProjectKnowledge(args.workspaceRoot),
    };
  } else {
    if (!session.taskMemory)
      session.taskMemory = { completed: [], active: [], pending: [], goal: "" };
    if (!session.workingMemory) session.workingMemory = { activeFiles: [] };
    if (!session.failureMemory) session.failureMemory = [];
    if (!session.projectKnowledge)
      session.projectKnowledge = getProjectKnowledge(args.workspaceRoot);
    if (!session.agentStatus) session.agentStatus = "🟢 Idle";
  }

  if (question && !args.executePlan) {
    session.messages.push({ role: "user", content: question });
    if (!session.developerTools) session.developerTools = [];
    session.developerTools.push({
      type: "timeline",
      data: { message: `User Message: ${question.slice(0, 50)}...` },
      timestamp: new Date().toLocaleTimeString(),
    });
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
  let goalData = null;

  if (!args.executePlan && question) {
    try {
      if (onStatus)
        onStatus(`[${new Date().toLocaleTimeString()}] 🧠 Analyzing intent...`);
      classification = await classifyIntent(question, loopArgs);
      if (onStatus)
        onStatus(
          `[${new Date().toLocaleTimeString()}] 🧭 Intent: ${classification.intent} (Mode: ${classification.execution_mode.toUpperCase()})`,
        );

      const prevGoal = session.taskMemory?.goal || "";
      goalData = await normalizeGoal(
        question,
        classification.intent,
        prevGoal,
        loopArgs,
      );

      if (goalData.resetMemory) {
        if (onStatus)
          onStatus(
            `[${new Date().toLocaleTimeString()}] 🧹 Resetting task memory...`,
          );
        session.taskMemory = {
          completed: [],
          active: [],
          pending: [],
          goal: goalData.goal,
          current_step: "Initializing",
        };
        session.workingMemory = { activeFiles: [] };
      } else {
        session.taskMemory.goal = goalData.goal;
      }

      if (goalData.extractedFacts) {
        const longTerm = shortTerm.getLongTermMemory();
        if (goalData.extractedFacts.name)
          longTerm.name = goalData.extractedFacts.name;
        if (Array.isArray(goalData.extractedFacts.preferences)) {
          longTerm.preferences = [
            ...new Set([
              ...longTerm.preferences,
              ...goalData.extractedFacts.preferences,
            ]),
          ];
        }
        if (Array.isArray(goalData.extractedFacts.facts)) {
          longTerm.facts = [
            ...new Set([...longTerm.facts, ...goalData.extractedFacts.facts]),
          ];
        }
        shortTerm.updateLongTermMemory(longTerm);
      }

      session.userProfile = shortTerm.getLongTermMemory();

      if (!session.developerTools) session.developerTools = [];
      session.developerTools.push({
        type: "timeline",
        data: {
          message: `Intent: ${classification.intent} | Goal: ${goalData.goal}`,
        },
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      console.error("[Agent OS] Pre-processing failed:", err);
      session.agentStatus = "🔴 Error";
      patchedOnChunk(
        `\n⚠️ **System Error:** Could not process intent. ${err.message}\n`,
      );
      const updatedSession = shortTerm.getSession(sessionId);
      if (updatedSession) {
        const lastAssistantMsg = [...updatedSession.messages]
          .reverse()
          .find((m) => m.role === "assistant");
        if (lastAssistantMsg) {
          lastAssistantMsg.content = fullResponse;
          lastAssistantMsg.streaming = false;
        }
        shortTerm.saveSession(sessionId, updatedSession);
      }
      return { status: "FAILED", context: null };
    }
  }

  let result;

  if (
    classification &&
    (classification.execution_mode === "chat" ||
      classification.execution_mode === "qa")
  ) {
    if (onStatus)
      onStatus(
        `[${new Date().toLocaleTimeString()}] 💬 Generating fast response...`,
      );
    try {
      session.agentStatus = "🟣 Reflecting";
      const historyCtx = session.messages
        .slice(-10)
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const userProfile = shortTerm.getLongTermMemory();
      const profileCtx =
        userProfile.name ||
        userProfile.preferences.length > 0 ||
        userProfile.facts.length > 0
          ? `\n\nUser Profile & Facts:\n${JSON.stringify(userProfile, null, 2)}`
          : "";

      const messages = [
        {
          role: "user",
          content: `Context:\n${historyCtx}${profileCtx}\n\nQuestion:\n${question}`,
        },
      ];

      const isStrict = classification.intent === "FACT_SHORT";
      let systemPrompt =
        "You are Jarvix, an advanced AI programming assistant. Provide a helpful, clear, and concise answer to the user's question. Focus on deep technical accuracy.";
      if (isStrict) {
        systemPrompt =
          'SYSTEM: Return ONLY the exact answer. No explanation. No punctuation unless required. No extra words. If you are not 100% sure, say "unknown". Do NOT guess dates, facts, or numbers.';
      }

      let rawDraft = "";
      await callLLM({
        messages,
        system: systemPrompt,
        model: args.model,
        provider: args.provider,
        onChunk: (c) => {
          rawDraft += c;
        },
      });

      if (isStrict) {
        // Validation Layer
        let finalOutput = rawDraft.trim();
        if (
          finalOutput.toLowerCase().includes("unknown") &&
          finalOutput.split(/\s+/).length <= 3
        ) {
          finalOutput = `⚠️ *I am not 100% certain of this exact fact, so I am withholding my answer to prevent hallucination.*`;
        } else if (finalOutput.split(/\s+/).length > 3) {
          finalOutput = `⚠️ *Could not extract a single-word fact.* Here are the details:\n\n${rawDraft}`;
        }
        patchedOnChunk(finalOutput);
      } else {
        if (onStatus)
          onStatus(
            `[${new Date().toLocaleTimeString()}] 🔎 Fact-checking response...`,
          );

        let factChecked = "";
        await callLLM({
          messages: [
            {
              role: "user",
              content: `Review this technical answer for factual accuracy. If it is 100% correct, output it exactly. If there are any misleading explanations, correct them seamlessly before outputting. Do not add metadata, just output the final text.\n\nDraft Answer:\n${rawDraft}`,
            },
          ],
          system:
            "You are a senior technical reviewer. Output only the final corrected response. DO NOT wrap the output in a markdown code block.",
          model: args.model,
          provider: args.provider,
          onChunk: (c) => {
            factChecked += c;
          },
        });

        let cleanedResponse = factChecked.trim();
        if (cleanedResponse.startsWith("```markdown")) {
          cleanedResponse = cleanedResponse
            .replace(/^```markdown\n?/i, "")
            .replace(/\n?```$/, "");
        } else if (cleanedResponse.startsWith("```")) {
          cleanedResponse = cleanedResponse
            .replace(/^```[a-z]*\n?/i, "")
            .replace(/\n?```$/, "");
        }

        // Stream after fact checking is complete
        patchedOnChunk(cleanedResponse.trim());
      }

      result = { status: "DONE", context: null };
      session.agentStatus = "🟢 Idle";
    } catch (err) {
      result = { status: "FAILED", context: null };
      session.agentStatus = "🔴 Error";
      patchedOnChunk(`\nError: ${err.message}\n`);
    }
  } else {
    session.agentStatus = "🔵 Executing";
    if (onStatus)
      onStatus(
        `[${new Date().toLocaleTimeString()}] 🧠 Initializing Agent OS...`,
      );
    result = await runAgentLoop(question, loopArgs);
    session.agentStatus = result.status === "FAILED" ? "🔴 Error" : "🟢 Idle";
  }

  const updatedSession = shortTerm.getSession(sessionId);
  if (updatedSession) {
    // Find the last assistant message, as system messages might have been appended during the loop
    const lastAssistantMsg = [...updatedSession.messages]
      .reverse()
      .find((m) => m.role === "assistant");

    if (lastAssistantMsg) {
      let finalContent = fullResponse;
      // We removed <jarvix-plan> from streaming, but if any was leftover, remove it.
      if (finalContent.includes("<jarvix-plan>")) {
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
