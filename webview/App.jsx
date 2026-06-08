import { useState, useEffect, useRef } from 'react';
import ChatWindow from './components/ChatWindow';
import ModelSelector from './components/ModelSelector';
import InputBar from './components/InputBar';
import SessionSidebar from './components/SessionSidebar';
import RightPanel from './components/RightPanel';

const vscode = acquireVsCodeApi();

function genId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

export default function App() {
  const [sessions, setSessions]               = useState({});
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeProvider, setActiveProvider]   = useState('openrouter');
  const [activeModel, setActiveModel]         = useState('qwen/qwen3-coder:free');
  const [isLoading, setIsLoading]             = useState(false);
  const [status, setStatus]                   = useState(null);
  const [statusHistory, setStatusHistory]     = useState([]);
  const [planModeEnabled, setPlanModeEnabled] = useState(true);
  const [rightPanelOpen, setRightPanelOpen]   = useState(true);
  const [workspaceFiles, setWorkspaceFiles]   = useState([]);

  // Streaming state — isolated so only the streaming bubble re-renders per token
  const [streamingMessage, setStreamingMessage] = useState(null); // { content, sessionId }
  const streamingSessionRef = useRef(null); // Tracks which session is actively streaming

  // Command Queue
  const commandQueueRef = useRef([]);
  const isProcessingCmdsRef = useRef(false);

  async function processCommandQueue() {
    if (isProcessingCmdsRef.current) return;
    isProcessingCmdsRef.current = true;

    while (commandQueueRef.current.length > 0) {
      const cmd = commandQueueRef.current.shift();
      if (cmd.status === 'cancelled') continue;
      
      vscode.postMessage({
        type: 'runTerminalCommand',
        sessionId: cmd.sessionId,
        messageIndex: cmd.messageIndex,
        commandIndex: cmd.commandIndex,
        command: cmd.command
      });

      await new Promise(r => setTimeout(r, 200));
    }
    
    isProcessingCmdsRef.current = false;
  }

  async function restoreStateFromMessages(sessionId, messagesArr) {
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
  }

  useEffect(() => {
    vscode.postMessage({ type: 'getSessions' });
    vscode.postMessage({ type: 'getWorkspaceFiles' });
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  function handleMessage(event) {
    const msg = event.data;

    if (msg.type === 'sessionsLoaded') {
      setSessions(msg.sessions);
      const ids = Object.keys(msg.sessions);
      if (ids.length > 0) {
        const latest = ids.sort(
          (a, b) => msg.sessions[b].createdAt - msg.sessions[a].createdAt
        )[0];
        setActiveSessionId(latest);
      }
    }

    if (msg.type === 'workspaceFiles') {
      setWorkspaceFiles(msg.files || []);
    }

    if (msg.type === 'status') {
      const s = msg.status;
      setStatus(s);
      if (s) {
        setStatusHistory(prev => {
          if (prev.length > 0 && prev[prev.length - 1] === s) return prev;
          return [...prev, s];
        });
      }
    }

    if (msg.type === 'fileAutoWritten') {
      setStatus(null);
      // Refresh workspace files after a write
      vscode.postMessage({ type: 'getWorkspaceFiles' });
    }

    if (msg.type === 'partialReply') {
      // Only update the isolated streaming state — NOT the sessions tree.
      // This prevents the entire app from re-rendering on every token.
      if (msg.sessionId === streamingSessionRef.current) {
        setStreamingMessage({ content: msg.content, sessionId: msg.sessionId });
      }
    }

    if (msg.type === 'reply') {
      // Streaming is done: merge the final session data and clear streaming state
      setStreamingMessage(null);
      streamingSessionRef.current = null;
      setSessions(prev => {
        const updated = { ...prev };
        if (msg.session) updated[msg.sessionId] = msg.session;
        return updated;
      });
      setIsLoading(false);
      setStatus(null);
      setStatusHistory([]);
    }

    if (msg.type === 'error') {
      setStreamingMessage(null);
      streamingSessionRef.current = null;
      setIsLoading(false);
      setStatus(null);
      setStatusHistory([]);
      console.error('Jarvix error:', msg.error);
    }

    if (msg.type === 'generationStopped') {
      setStreamingMessage(null);
      streamingSessionRef.current = null;
      setIsLoading(false);
      setStatus(null);
      setStatusHistory([]);
    }

    if (msg.type === 'fileChanged') {
      setSessions(prev => {
        const updated = { ...prev };
        for (const sessId of Object.keys(updated)) {
          const sess = updated[sessId];
          if (!sess || !sess.messages) continue;
          let changed = false;
          for (const message of sess.messages) {
            if (!message.fileEdits) continue;
            for (const edit of message.fileEdits) {
              if (
                edit.filePath &&
                msg.filePath &&
                edit.filePath.toLowerCase().replace(/\\/g, '/') ===
                  msg.filePath.toLowerCase().replace(/\\/g, '/')
              ) {
                edit.newCode = msg.content;
                changed = true;
              }
            }
          }
          if (changed) updated[sessId] = { ...sess };
        }
        return updated;
      });
    }
  }

  // ── Session handlers ──────────────────────────────────────────────────────
  function handleNewSession() {
    const id         = genId();
    const newSession = { id, title: 'New Session', messages: [], createdAt: Date.now() };
    setSessions(prev => ({ ...prev, [id]: newSession }));
    setActiveSessionId(id);
    vscode.postMessage({ type: 'saveSession', sessionId: id, session: newSession });
  }

  function handleSelectSession(id)   { setActiveSessionId(id); }

  function handleClearAll() {
    setSessions({});
    setActiveSessionId(null);
    vscode.postMessage({ type: 'clearAllSessions' });
  }

  function handleDeleteSession(id) {
    setSessions(prev => { const u = { ...prev }; delete u[id]; return u; });
    if (activeSessionId === id) setActiveSessionId(null);
    vscode.postMessage({ type: 'deleteSession', sessionId: id });
  }

  function handleRenameSession(id, title) {
    setSessions(prev => {
      const updated = { ...prev };
      if (updated[id]) {
        updated[id] = { ...updated[id], title };
        vscode.postMessage({ type: 'saveSession', sessionId: id, session: updated[id] });
      }
      return updated;
    });
  }

  // ── Send / Stop ───────────────────────────────────────────────────────────
  function handleSend({ text, explicitFiles = [], attachedImages = [] } = {}) {
    // Support both old string signature and new object signature
    const question = typeof text === 'string' ? text : (typeof arguments[0] === 'string' ? arguments[0] : '');
    if (!question.trim()) return;

    let sessionId = activeSessionId;

    if (!sessionId || !sessions[sessionId]) {
      sessionId = genId();
      const newSession = {
        id: sessionId,
        title: question.slice(0, 40),
        messages: [],
        createdAt: Date.now()
      };
      setSessions(prev => ({ ...prev, [sessionId]: newSession }));
      setActiveSessionId(sessionId);
    }

    streamingSessionRef.current = sessionId;
    setIsLoading(true);
    setStatusHistory([]);
    vscode.postMessage({
      type: 'ask',
      question,
      model: activeModel,
      provider: activeProvider,
      sessionId,
      planModeEnabled,
      explicitFiles,
      attachedImages,
    });
  }

  function handleStop() {
    vscode.postMessage({ type: 'stopGeneration' });
    setIsLoading(false);
    setStatus(null);
    setStatusHistory([]);
  }

  // ── Edit & Regenerate ─────────────────────────────────────────────────────
  async function handleEditAndResend(messageIndex, newText) {
    handleStop();
    const session = sessions[activeSessionId];
    if (!session) return;

    // Cancel queued commands from deleted messages
    commandQueueRef.current.forEach(c => {
      if (c.sessionId === activeSessionId && c.messageIndex >= messageIndex) {
        c.status = 'cancelled';
      }
    });

    const newMessages = session.messages.slice(0, messageIndex);
    setSessions(prev => ({
      ...prev,
      [activeSessionId]: { ...session, messages: newMessages }
    }));
    vscode.postMessage({
      type: 'saveSession',
      sessionId: activeSessionId,
      session: { ...session, messages: newMessages }
    });

    await restoreStateFromMessages(activeSessionId, newMessages);
    handleSend({ text: newText });
  }

  async function handleRegenerate(messageIndex) {
    handleStop();
    const session = sessions[activeSessionId];
    if (!session) return;

    // Cancel queued commands from deleted messages
    commandQueueRef.current.forEach(c => {
      if (c.sessionId === activeSessionId && c.messageIndex >= messageIndex) {
        c.status = 'cancelled';
      }
    });

    let userMsg = null;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        userMsg = session.messages[i];
        break;
      }
    }
    if (!userMsg) return;

    const newMessages = session.messages.slice(0, messageIndex);
    setSessions(prev => ({
      ...prev,
      [activeSessionId]: { ...session, messages: newMessages }
    }));
    vscode.postMessage({
      type: 'saveSession',
      sessionId: activeSessionId,
      session: { ...session, messages: newMessages }
    });

    const userText = (userMsg.content || '').replace(/^[\s\S]*?USER REQUEST:\s*/i, '').trim() || userMsg.content;
    
    await restoreStateFromMessages(activeSessionId, newMessages);
    handleSend({ text: userText });
  }

  // ── File handlers ─────────────────────────────────────────────────────────
  function handleApplyCode(code) {
    vscode.postMessage({ type: 'writeFile', code, filePath: null });
  }

  function handleAcceptFile(messageIndex, fileIndex, editedCode) {
    const session = sessions[activeSessionId];
    if (session?.messages[messageIndex]) {
      const edit = session.messages[messageIndex].fileEdits[fileIndex];
      vscode.postMessage({
        type: 'applyPendingFile',
        sessionId: activeSessionId,
        messageIndex,
        fileIndex,
        filePath: edit.filePath,
        // Use user-edited code if provided, otherwise the AI-generated code
        code: editedCode !== undefined ? editedCode : edit.newCode,
        isNew: edit.isNew,
        isDelete: edit.isDelete,
        originalCode: edit.originalCode,
      });
    }
  }

  function handleDeclineFile(messageIndex, fileIndex) {
    vscode.postMessage({ type: 'declinePendingFile', sessionId: activeSessionId, messageIndex, fileIndex });
  }

  function handleViewDiff(messageIndex, fileIndex) {
    const session = sessions[activeSessionId];
    if (session?.messages[messageIndex]) {
      const edit = session.messages[messageIndex].fileEdits[fileIndex];
      vscode.postMessage({
        type: 'viewDiff',
        filePath: edit.filePath,
        isNew: edit.isNew,
        originalCode: edit.originalCode,
        proposedCode: edit.newCode
      });
    }
  }

  function handleAcceptAllFiles(messageIndex) {
    const session = sessions[activeSessionId];
    if (session?.messages[messageIndex]) {
      const fileEdits = session.messages[messageIndex].fileEdits;
      if (fileEdits) {
        fileEdits.forEach((edit, fileIndex) => {
          if (edit.status === 'pending') {
            vscode.postMessage({
              type: 'applyPendingFile',
              sessionId: activeSessionId,
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
  }

  function handleDeclineAllFiles(messageIndex) {
    const session = sessions[activeSessionId];
    if (session?.messages[messageIndex]) {
      const fileEdits = session.messages[messageIndex].fileEdits;
      if (fileEdits) {
        fileEdits.forEach((edit, fileIndex) => {
          if (edit.status === 'pending') {
            vscode.postMessage({
              type: 'declinePendingFile',
              sessionId: activeSessionId,
              messageIndex,
              fileIndex
            });
          }
        });
      }
    }
  }

  function handleAcceptCommand(messageIndex, commandIndex) {
    const session = sessions[activeSessionId];
    if (session?.messages[messageIndex]) {
      const cmd = session.messages[messageIndex].suggestedCommands[commandIndex];
      const cmdId = `${activeSessionId}-${messageIndex}-${commandIndex}`;
      
      // Deduplicate: Don't enqueue if it's already pending
      if (!commandQueueRef.current.some(c => c.id === cmdId && c.status !== 'cancelled')) {
        commandQueueRef.current.push({
          id: cmdId,
          sessionId: activeSessionId,
          messageIndex,
          commandIndex,
          command: cmd.command,
          status: 'pending'
        });
        processCommandQueue();
      }
    }
  }

  function handleDeclineCommand(messageIndex, commandIndex) {
    vscode.postMessage({
      type: 'declineTerminalCommand',
      sessionId: activeSessionId,
      messageIndex,
      commandIndex
    });
  }

  function handleApprovePlan(messageIndex) {
    setIsLoading(true);
    setSessions(prev => {
      const updated = { ...prev };
      if (updated[activeSessionId] && updated[activeSessionId].messages[messageIndex]) {
        updated[activeSessionId].messages[messageIndex].planStatus = 'approved';
      }
      return updated;
    });
    vscode.postMessage({
      type: 'approvePlan',
      sessionId: activeSessionId,
      messageIndex,
      model: activeModel,
      provider: activeProvider
    });
  }

  const activeSession = sessions[activeSessionId];
  const messages      = activeSession?.messages || [];

  return (
    <div className="app">
      {/* Left sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onClearAll={handleClearAll}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
      />

      {/* Main chat */}
      <div className="main">
        {/* Top bar */}
        <div className="top-bar">
          <ModelSelector
            activeProvider={activeProvider}
            activeModel={activeModel}
            onProviderChange={setActiveProvider}
            onModelChange={setActiveModel}
            disabled={isLoading}
          />

          <div className="plan-mode-toggle">
            <input
              type="checkbox"
              id="planModeToggle"
              checked={planModeEnabled}
              onChange={e => setPlanModeEnabled(e.target.checked)}
              disabled={isLoading}
            />
            <label htmlFor="planModeToggle">📋 Plan mode</label>
          </div>

          <button
            className={`right-panel-toggle-btn ${rightPanelOpen ? 'active' : ''}`}
            onClick={() => setRightPanelOpen(o => !o)}
            title={rightPanelOpen ? 'Hide context panel' : 'Show context panel'}
          >
            {rightPanelOpen ? '◧ Hide Panel' : '◨ Context'}
          </button>
        </div>

        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          onApplyCode={handleApplyCode}
          statusHistory={statusHistory}
          onAcceptFile={handleAcceptFile}
          onDeclineFile={handleDeclineFile}
          onAcceptAllFiles={handleAcceptAllFiles}
          onDeclineAllFiles={handleDeclineAllFiles}
          onAcceptCommand={handleAcceptCommand}
          onDeclineCommand={handleDeclineCommand}
          onApprovePlan={handleApprovePlan}
          onEdit={handleEditAndResend}
          onRegenerate={handleRegenerate}
          onViewDiff={handleViewDiff}
          streamingMessage={streamingMessage}
          activeSessionId={activeSessionId}
        />

        <InputBar
          onSend={handleSend}
          onStop={handleStop}
          isLoading={isLoading}
          workspaceFiles={workspaceFiles}
        />
      </div>

      {/* Right panel */}
      {rightPanelOpen && (
        <RightPanel
          statusHistory={statusHistory}
          isLoading={isLoading}
          messages={messages}
          session={activeSession}
          workspaceFiles={workspaceFiles}
        />
      )}
    </div>
  );
}