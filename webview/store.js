import { create } from "zustand";

// Safe acquisition of vscode api
const vscode =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;

function genId() {
  return "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

export const useStore = create((set, get) => ({
  // ── State ─────────────────────────────────────────────────────────────
  sessions: {},
  activeSessionId: null,
  activeProvider: "mistral",
  activeModel: "open-mistral-7b",
  isLoading: false,
  status: null,
  statusHistory: [],
  planModeEnabled: true,
  rightPanelOpen: true,
  workspaceFiles: [],
  liveAgentState: null,
  streamingMessage: null,
  activeWorkspaceView: null, // { type: 'plan' | 'diff' | 'code', messageIndex, fileIndex? }
  approvalMode: "balanced", // 'safe', 'balanced', 'strict'
  devModeEnabled: true,
  // ── Task Execution Runtime state ───────────────────────────────────────
  executionProgress: null, // { planId, phases[], steps{}, runtimeState, checkpointedAt }

  // ── Internal refs ─────────────────────────────────────────────────────
  _commandQueue: [],
  _isProcessingCmds: false,

  // ── Init (Setup Listeners) ────────────────────────────────────────────
  init: () => {
    if (vscode) {
      vscode.postMessage({ type: "getSessions" });
      vscode.postMessage({ type: "getWorkspaceFiles" });
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;

      if (msg.type === "sessionsLoaded") {
        const ids = Object.keys(msg.sessions);
        let latest = null;
        if (ids.length > 0) {
          latest = ids.sort(
            (a, b) => msg.sessions[b].createdAt - msg.sessions[a].createdAt,
          )[0];
        }
        set({ sessions: msg.sessions, activeSessionId: latest });
      }

      if (msg.type === "workspaceFiles")
        set({ workspaceFiles: msg.files || [] });

      if (msg.type === "status") {
        set((state) => {
          if (!msg.status) return { status: null };
          const hist = [...state.statusHistory];
          if (hist.length === 0 || hist[hist.length - 1] !== msg.status) {
            hist.push(msg.status);
          }
          return { status: msg.status, statusHistory: hist };
        });
      }

      if (msg.type === "JOURNAL_EVENT") {
        set((state) => {
          const event = msg.event;
          let statusText = null;
          switch (event.eventType) {
            case "RequestStarted":
              statusText = `[SYS] Starting task...`;
              break;
            case "PlanningStarted":
              statusText = `[PLAN] Designing graph...`;
              break;
            case "PlanningFinished":
              statusText = `[PLAN] Graph compiled.`;
              break;
            case "ToolStarted":
              statusText = `[EXEC] Running ${event.data.tool}...`;
              break;
            case "ProposedEditCreated":
              statusText = `[APPROVAL] Proposed edit for ${event.data.filePath}`;
              break;
            case "ProposedCommandCreated":
              statusText = `[APPROVAL] Proposed command: ${event.data.command}`;
              break;
            case "ToolSucceeded":
              const isFailed =
                event.data.result && event.data.result.success === false;
              statusText = isFailed
                ? `[ERROR] Failed node ${event.data.nodeId}`
                : `[EXEC] Completed node ${event.data.nodeId}`;
              break;
            case "ExecutionFinished":
              statusText = event.data.success
                ? `[SYS] Task complete.`
                : `[SYS] Task failed.`;
              break;
          }
          if (statusText) {
            const hist = [...state.statusHistory];
            const time = new Date().toLocaleTimeString();
            const fullStatus = `[${time}] ${statusText}`;
            if (hist.length === 0 || hist[hist.length - 1] !== fullStatus) {
              hist.push(fullStatus);
            }
            return { status: statusText, statusHistory: hist };
          }
          return {};
        });
      }

      if (msg.type === "AGENT_STATE") {
        set((state) => ({
          liveAgentState: {
            ...(state.liveAgentState || {}),
            phase:
              msg.phase !== undefined ? msg.phase : state.liveAgentState?.phase,
            currentStep:
              msg.currentStep !== undefined
                ? msg.currentStep
                : state.liveAgentState?.currentStep,
            activeTool:
              msg.activeTool !== undefined
                ? msg.activeTool
                : state.liveAgentState?.activeTool,
            executionStatus:
              msg.executionStatus !== undefined
                ? msg.executionStatus
                : state.liveAgentState?.executionStatus,
            totalSteps:
              msg.totalSteps !== undefined
                ? msg.totalSteps
                : state.liveAgentState?.totalSteps,
            budget:
              msg.budget !== undefined
                ? msg.budget
                : state.liveAgentState?.budget,
            lastResult:
              msg.lastResult !== undefined
                ? msg.lastResult
                : state.liveAgentState?.lastResult,
            goal:
              msg.goal !== undefined ? msg.goal : state.liveAgentState?.goal,
            intent:
              msg.intent !== undefined
                ? msg.intent
                : state.liveAgentState?.intent,
            entities:
              msg.entities !== undefined
                ? msg.entities
                : state.liveAgentState?.entities,
            contextTokens:
              msg.contextTokens !== undefined
                ? msg.contextTokens
                : state.liveAgentState?.contextTokens,
            retrievedContext:
              msg.retrievedContext !== undefined
                ? msg.retrievedContext
                : state.liveAgentState?.retrievedContext,
            plan:
              msg.plan !== undefined ? msg.plan : state.liveAgentState?.plan,
            selectedSkills:
              msg.selectedSkills !== undefined
                ? msg.selectedSkills
                : state.liveAgentState?.selectedSkills,
            reflection:
              msg.reflection !== undefined
                ? msg.reflection
                : state.liveAgentState?.reflection,
          },
        }));
      }

      // ── Task Execution Runtime progress ─────────────────────────────
      if (msg.type === "EXECUTION_PROGRESS") {
        set((state) => {
          const prev = state.executionProgress || {};

          // Build / update the per-step map
          const steps = { ...(prev.steps || {}) };

          if (msg.event === "STEP_START") {
            steps[msg.stepIndex] = {
              ...steps[msg.stepIndex],
              status: "running",
              action: msg.stepAction,
              tool: msg.tool,
              phase: msg.phase,
              retryCount: msg.retryCount || 0,
              startedAt: msg.timestamp,
            };
          }

          if (msg.event === "STEP_DONE") {
            steps[msg.stepIndex] = {
              ...steps[msg.stepIndex],
              status: "done",
              completedAt: msg.timestamp,
              checkpointedAt: msg.checkpointedAt,
            };
          }

          if (msg.event === "STEP_VERIFIED") {
            steps[msg.stepIndex] = {
              ...steps[msg.stepIndex],
              verified: msg.passed,
              verificationChecks: msg.checks,
              verificationIssues: msg.issues,
            };
          }

          if (msg.event === "STEP_RETRY") {
            steps[msg.stepIndex] = {
              ...steps[msg.stepIndex],
              status: "retrying",
              retryCount: msg.retryCount,
              maxRetries: msg.maxRetries,
              retryReason: msg.retryReason,
              lastError: msg.lastError,
            };
          }

          const runtimeState =
            msg.event === "RUNTIME_COMPLETE"
              ? "COMPLETED"
              : msg.event === "RUNTIME_ABORTED"
                ? "ABORTED"
                : msg.event === "RUNTIME_PAUSED"
                  ? "PAUSED"
                  : msg.event === "RUNTIME_RESUMED"
                    ? "RUNNING"
                    : msg.event === "RUNTIME_ESCALATE"
                      ? "FAILED"
                      : msg.event === "RUNTIME_START"
                        ? "RUNNING"
                        : prev.runtimeState || "IDLE";

          return {
            executionProgress: {
              ...prev,
              planId: msg.planId || prev.planId,
              phases: msg.phases || prev.phases || [],
              steps,
              runtimeState,
              totalSteps: msg.totalSteps || prev.totalSteps || 0,
              checkpointedAt: msg.checkpointedAt || prev.checkpointedAt,
              lastEvent: msg.event,
              lastEventAt: msg.timestamp,
            },
          };
        });
      }

      if (msg.type === "fileAutoWritten") {
        set({ status: null });
        if (vscode) vscode.postMessage({ type: "getWorkspaceFiles" });
      }

      if (msg.type === "partialReply") {
        const state = get();
        // Since we are streaming to the active session
        if (msg.sessionId === state.activeSessionId) {
          set({
            streamingMessage: {
              content: msg.content,
              sessionId: msg.sessionId,
            },
          });
        }
      }

      if (msg.type === "reply") {
        set((state) => {
          const updated = { ...state.sessions };
          if (msg.session) updated[msg.sessionId] = msg.session;
          return {
            sessions: updated,
            streamingMessage: null,
            isLoading: false,
            status: null,
            statusHistory: [],
          };
        });
      }

      if (msg.type === "error" || msg.type === "generationStopped") {
        if (msg.type === "error") console.error("Jarvix error:", msg.error);
        set({
          streamingMessage: null,
          isLoading: false,
          status: null,
          statusHistory: [],
        });
      }

      if (msg.type === "fileChanged") {
        const normalizedMsgPath = msg.filePath
          ?.toLowerCase()
          .replace(/\\/g, "/");
        if (!normalizedMsgPath) return;

        set((state) => {
          let hasAnyChange = false;
          const updated = Object.fromEntries(
            Object.entries(state.sessions).map(([sessId, sess]) => {
              if (!sess?.messages) return [sessId, sess];
              let sessChanged = false;
              const newMessages = sess.messages.map((message) => {
                if (!message.fileEdits) return message;
                let editChanged = false;
                const newEdits = message.fileEdits.map((edit) => {
                  if (
                    edit.filePath?.toLowerCase().replace(/\\/g, "/") ===
                    normalizedMsgPath
                  ) {
                    editChanged = true;
                    return { ...edit, newCode: msg.content };
                  }
                  return edit;
                });
                if (!editChanged) return message;
                sessChanged = true;
                return { ...message, fileEdits: newEdits };
              });
              if (!sessChanged) return [sessId, sess];
              hasAnyChange = true;
              return [sessId, { ...sess, messages: newMessages }];
            }),
          );
          return hasAnyChange ? { sessions: updated } : {};
        });
      }
    });
  },

  // ── Actions ───────────────────────────────────────────────────────────
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  setActiveProvider: (provider) => set({ activeProvider: provider }),
  setActiveModel: (model) => set({ activeModel: model }),
  setPlanModeEnabled: (enabled) => set({ planModeEnabled: enabled }),
  setRightPanelOpen: (open) =>
    set({
      rightPanelOpen:
        typeof open === "function" ? open(get().rightPanelOpen) : open,
    }),
  setActiveWorkspaceView: (view) => set({ activeWorkspaceView: view }),
  setApprovalMode: (mode) => set({ approvalMode: mode }),
  setDevModeEnabled: (enabled) => set({ devModeEnabled: enabled }),

  handleMockRun: () => {
    const states = [
      { status: "CLASSIFYING", delay: 1000 },
      { status: "PLANNING", delay: 2000 },
      { status: "AWAITING_PLAN_APPROVAL", delay: 5000 }, // Wait for 5s
      { status: "EXECUTING", delay: 3000 },
      { status: "AWAITING_COMMAND_APPROVAL", delay: 3000 },
      { status: "EXECUTING", delay: 2000 },
      { status: "VERIFYING", delay: 2000 },
      { status: "COMPLETED", delay: 1000 },
      { status: "IDLE", delay: 1000 },
    ];
    let delayAccumulator = 0;
    states.forEach(({ status, delay }) => {
      setTimeout(() => {
        set((state) => {
          const hist = [...state.statusHistory];
          if (hist.length === 0 || hist[hist.length - 1] !== status) {
            hist.push(status);
          }

          // Also mock some progress data if executing
          let executionProgress = state.executionProgress;
          if (status === "EXECUTING") {
            executionProgress = {
              planId: "mock-plan-1",
              steps: {
                0: {
                  status: "done",
                  action: "Install dependencies",
                  tool: "run_command",
                },
                1: {
                  status: "running",
                  action: "Modify auth.js",
                  tool: "write_file",
                },
              },
              runtimeState: "RUNNING",
            };
          } else if (status === "COMPLETED") {
            executionProgress = {
              ...executionProgress,
              runtimeState: "COMPLETED",
            };
          }

          return { status, statusHistory: hist, executionProgress };
        });
      }, delayAccumulator);
      delayAccumulator += delay;
    });
  },

  handleNewSession: () => {
    const id = genId();
    const newSession = {
      id,
      title: "New Session",
      messages: [],
      createdAt: Date.now(),
    };
    set((state) => ({
      sessions: { ...state.sessions, [id]: newSession },
      activeSessionId: id,
    }));
    if (vscode)
      vscode.postMessage({
        type: "saveSession",
        sessionId: id,
        session: newSession,
      });
  },

  handleClearAll: () => {
    set({ sessions: {}, activeSessionId: null });
    if (vscode) vscode.postMessage({ type: "clearAllSessions" });
  },

  handleDeleteSession: (id) => {
    set((state) => {
      const u = { ...state.sessions };
      delete u[id];
      return {
        sessions: u,
        activeSessionId:
          state.activeSessionId === id ? null : state.activeSessionId,
      };
    });
    if (vscode) vscode.postMessage({ type: "deleteSession", sessionId: id });
  },

  handleRenameSession: (id, title) => {
    set((state) => {
      const updated = { ...state.sessions };
      if (updated[id]) {
        updated[id] = { ...updated[id], title };
        if (vscode)
          vscode.postMessage({
            type: "saveSession",
            sessionId: id,
            session: updated[id],
          });
      }
      return { sessions: updated };
    });
  },

  handleSend: ({ text, explicitFiles = [], attachedImages = [] } = {}) => {
    console.log("[Jarvix Debug] store.handleSend started. Text:", text);
    const state = get();
    const question = typeof text === "string" ? text : "";
    if (!question.trim()) {
      console.log(
        "[Jarvix Debug] store.handleSend aborted: question is empty.",
      );
      return;
    }

    let sessionId = state.activeSessionId;
    let newSessions = { ...state.sessions };

    if (!sessionId || !newSessions[sessionId]) {
      sessionId = genId();
      const newSession = {
        id: sessionId,
        title: question.trim().slice(0, 40) || "New Chat",
        messages: [],
        createdAt: Date.now(),
      };
      newSessions[sessionId] = newSession;
    }

    set({
      sessions: newSessions,
      activeSessionId: sessionId,
      isLoading: true,
      statusHistory: [],
      streamingMessage: null,
    });

    if (vscode) {
      console.log(
        "[Jarvix Debug] store.handleSend: vscode is defined, posting 'ask' message.",
      );
      vscode.postMessage({
        type: "ask",
        question,
        model: state.activeModel,
        provider: state.activeProvider,
        sessionId,
        planModeEnabled: state.planModeEnabled,
        explicitFiles,
        attachedImages,
      });
    } else {
      console.log(
        "[Jarvix Debug] store.handleSend: vscode API is null! Message not sent to extension.",
      );
    }
  },

  handleStop: () => {
    if (vscode) vscode.postMessage({ type: "stopGeneration" });
    set({
      isLoading: false,
      status: null,
      statusHistory: [],
      executionProgress: null,
    });
  },

  // ── Runtime control ────────────────────────────────────────────
  handleRuntimePause: () => {
    const state = get();
    if (vscode)
      vscode.postMessage({
        type: "runtimePause",
        sessionId: state.activeSessionId,
      });
  },

  handleRuntimeResume: (modifiedSteps) => {
    const state = get();
    if (vscode)
      vscode.postMessage({
        type: "runtimeResume",
        sessionId: state.activeSessionId,
        modifiedSteps,
      });
  },

  handleRuntimeAbort: () => {
    const state = get();
    if (vscode)
      vscode.postMessage({
        type: "runtimeAbort",
        sessionId: state.activeSessionId,
      });
    set({ isLoading: false, status: null, statusHistory: [] });
  },

  // Queue helper for terminal commands
  _processCommandQueue: async () => {
    const state = get();
    if (state._isProcessingCmds) return;
    set({ _isProcessingCmds: true });

    while (get()._commandQueue.length > 0) {
      const cmd = get()._commandQueue.shift();
      if (cmd.status === "cancelled") continue;

      if (vscode) {
        vscode.postMessage({
          type: "runTerminalCommand",
          sessionId: cmd.sessionId,
          messageIndex: cmd.messageIndex,
          commandIndex: cmd.commandIndex,
          command: cmd.command,
        });
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    set({ _isProcessingCmds: false });
  },

  handleAcceptCommand: (messageIndex, commandIndex) => {
    const state = get();
    const session = state.sessions[state.activeSessionId];
    if (session?.messages[messageIndex]) {
      const cmd =
        session.messages[messageIndex].suggestedCommands[commandIndex];
      const cmdId = `${state.activeSessionId}-${messageIndex}-${commandIndex}`;

      const queue = [...state._commandQueue];
      if (!queue.some((c) => c.id === cmdId && c.status !== "cancelled")) {
        queue.push({
          id: cmdId,
          sessionId: state.activeSessionId,
          messageIndex,
          commandIndex,
          command: cmd.command,
          status: "pending",
        });
        set({ _commandQueue: queue });
        get()._processCommandQueue();
      }
    }
  },

  handleDeclineCommand: (messageIndex, commandIndex) => {
    const state = get();
    if (vscode) {
      vscode.postMessage({
        type: "declineTerminalCommand",
        sessionId: state.activeSessionId,
        messageIndex,
        commandIndex,
      });
    }
  },

  handleApprovePlan: (messageIndex) => {
    const state = get();
    set((s) => {
      const updated = { ...s.sessions };
      if (
        updated[s.activeSessionId] &&
        updated[s.activeSessionId].messages[messageIndex]
      ) {
        updated[s.activeSessionId].messages[messageIndex].planStatus =
          "approved";
      }
      return { sessions: updated, isLoading: true };
    });

    if (vscode) {
      vscode.postMessage({
        type: "approvePlan",
        sessionId: state.activeSessionId,
        messageIndex,
        model: state.activeModel,
        provider: state.activeProvider,
      });
    }
  },

  // File handlers
  handleApplyCode: (code) => {
    if (vscode) vscode.postMessage({ type: "writeFile", code, filePath: null });
  },

  handleAcceptFile: (messageIndex, fileIndex, editedCode) => {
    const state = get();
    const session = state.sessions[state.activeSessionId];
    if (session?.messages[messageIndex]?.fileEdits) {
      const edit = session.messages[messageIndex].fileEdits[fileIndex];
      if (vscode) {
        vscode.postMessage({
          type: "applyPendingFile",
          sessionId: state.activeSessionId,
          messageIndex,
          fileIndex,
          filePath: edit.filePath,
          code: editedCode !== undefined ? editedCode : edit.newCode,
          isNew: edit.isNew,
          isDelete: edit.isDelete,
          originalCode: edit.originalCode,
          _approvalId: edit._approvalId,
        });
      }
    }
  },

  handleDeclineFile: (messageIndex, fileIndex) => {
    const state = get();
    if (vscode) {
      vscode.postMessage({
        type: "declinePendingFile",
        sessionId: state.activeSessionId,
        messageIndex,
        fileIndex,
        _approvalId:
          state.sessions[state.activeSessionId]?.messages[messageIndex]
            ?.fileEdits[fileIndex]?._approvalId,
      });
    }
  },

  handleUndoDeclineFile: (messageIndex, fileIndex) => {
    const state = get();
    if (vscode) {
      vscode.postMessage({
        type: "undoDeclinePendingFile",
        sessionId: state.activeSessionId,
        messageIndex,
        fileIndex,
      });
    }
  },

  handleViewDiff: (messageIndex, fileIndex) => {
    const state = get();
    const session = state.sessions[state.activeSessionId];
    if (session?.messages[messageIndex]?.fileEdits) {
      const edit = session.messages[messageIndex].fileEdits[fileIndex];
      if (vscode) {
        vscode.postMessage({
          type: "viewDiff",
          filePath: edit.filePath,
          isNew: edit.isNew,
          originalCode: edit.originalCode,
          proposedCode: edit.newCode,
        });
      }
    }
  },

  handleAcceptAllFiles: (messageIndex) => {
    const state = get();
    const session = state.sessions[state.activeSessionId];
    if (session?.messages[messageIndex]) {
      const fileEdits = session.messages[messageIndex].fileEdits;
      if (fileEdits && vscode) {
        fileEdits.forEach((edit, fileIndex) => {
          if (edit.status === "pending") {
            vscode.postMessage({
              type: "applyPendingFile",
              sessionId: state.activeSessionId,
              messageIndex,
              fileIndex,
              filePath: edit.filePath,
              code: edit.newCode,
              isNew: edit.isNew,
              isDelete: edit.isDelete,
              originalCode: edit.originalCode,
            });
          }
        });
      }
    }
  },

  handleDeclineAllFiles: (messageIndex) => {
    const state = get();
    const session = state.sessions[state.activeSessionId];
    if (session?.messages[messageIndex]) {
      const fileEdits = session.messages[messageIndex].fileEdits;
      if (fileEdits && vscode) {
        fileEdits.forEach((edit, fileIndex) => {
          if (edit.status === "pending") {
            vscode.postMessage({
              type: "declinePendingFile",
              sessionId: state.activeSessionId,
              messageIndex,
              fileIndex,
            });
          }
        });
      }
    }
  },

  // Edit/Regenerate
  _restoreStateFromMessages: async (sessionId, messagesArr) => {
    let stateToRestore = { plan: [], workingMemory: {}, recentErrors: [] };
    for (let i = messagesArr.length - 1; i >= 0; i--) {
      if (messagesArr[i].stateSnapshot) {
        stateToRestore = messagesArr[i].stateSnapshot;
        break;
      }
    }
    try {
      await fetch("http://127.0.0.1:3131/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, state: stateToRestore }),
      });
    } catch (e) {
      console.error("Failed to restore state", e);
    }
  },

  handleEditAndResend: async (messageIndex, newText) => {
    const state = get();
    state.handleStop();
    const session = state.sessions[state.activeSessionId];
    if (!session) return;

    const queue = [...state._commandQueue];
    queue.forEach((c) => {
      if (
        c.sessionId === state.activeSessionId &&
        c.messageIndex >= messageIndex
      ) {
        c.status = "cancelled";
      }
    });

    const newMessages = session.messages.slice(0, messageIndex);
    const newSession = { ...session, messages: newMessages };

    set({
      _commandQueue: queue,
      sessions: { ...state.sessions, [state.activeSessionId]: newSession },
    });

    if (vscode)
      vscode.postMessage({
        type: "saveSession",
        sessionId: state.activeSessionId,
        session: newSession,
      });

    await state._restoreStateFromMessages(state.activeSessionId, newMessages);
    state.handleSend({ text: newText });
  },

  handleRegenerate: async (messageIndex) => {
    const state = get();
    state.handleStop();
    const session = state.sessions[state.activeSessionId];
    if (!session) return;

    const queue = [...state._commandQueue];
    queue.forEach((c) => {
      if (
        c.sessionId === state.activeSessionId &&
        c.messageIndex >= messageIndex
      ) {
        c.status = "cancelled";
      }
    });

    let userMsg = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (session.messages[i].role === "user") {
        userMsg = session.messages[i];
        break;
      }
    }
    if (!userMsg) return;

    const newMessages = session.messages.slice(0, messageIndex);
    const newSession = { ...session, messages: newMessages };

    set({
      _commandQueue: queue,
      sessions: { ...state.sessions, [state.activeSessionId]: newSession },
    });

    if (vscode)
      vscode.postMessage({
        type: "saveSession",
        sessionId: state.activeSessionId,
        session: newSession,
      });

    const userText =
      (userMsg.content || "")
        .replace(/^[\s\S]*?USER REQUEST:\s*/i, "")
        .trim() || userMsg.content;
    await state._restoreStateFromMessages(state.activeSessionId, newMessages);
    state.handleSend({ text: userText });
  },
}));
