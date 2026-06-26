import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import FileDiffViewer from './FileDiffViewer';
import CommandPermissionViewer from './CommandPermissionViewer';
import { useStore } from '../store';

// ─── Collapsible Diff Viewer ────────────────────────────────────────────────
function DiffViewer({ originalCode = '', newCode = '', isNew = false, isDelete = false }) {
  const [isOpen, setIsOpen] = useState(false);

  const generateDiffLines = () => {
    const oldLines = (originalCode || '').split('\n');
    const newLines = (newCode || '').split('\n');
    
    if (isNew) {
      return newLines.map((line, idx) => ({
        type: 'added',
        text: line,
        newNum: idx + 1,
        prefix: '+'
      }));
    }
    
    if (isDelete) {
      return oldLines.map((line, idx) => ({
        type: 'removed',
        text: line,
        oldNum: idx + 1,
        prefix: '-'
      }));
    }

    const diff = [];
    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        diff.push({ type: 'unchanged', text: oldLines[i], oldNum: i + 1, newNum: j + 1, prefix: ' ' });
        i++;
        j++;
      } else {
        let matchOffset = -1;
        for (let k = 1; k < 10; k++) {
          if (i + k < oldLines.length && oldLines[i + k] === newLines[j]) {
            matchOffset = k;
            break;
          }
        }
        if (matchOffset !== -1) {
          for (let k = 0; k < matchOffset; k++) {
            diff.push({ type: 'removed', text: oldLines[i], oldNum: i + 1, prefix: '-' });
            i++;
          }
        } else {
          if (j < newLines.length) {
            diff.push({ type: 'added', text: newLines[j], newNum: j + 1, prefix: '+' });
            j++;
          } else if (i < oldLines.length) {
            diff.push({ type: 'removed', text: oldLines[i], oldNum: i + 1, prefix: '-' });
            i++;
          }
        }
      }
    }
    return diff;
  };

  const diffLines = isOpen ? generateDiffLines() : [];

  return (
    <div className="diff-dropdown" style={{ borderTop: '1px solid var(--vscode-widget-border, #333)' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          cursor: 'pointer',
          background: 'rgba(255, 255, 255, 0.02)',
          userSelect: 'none',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-muted, #aaa)'
        }}
      >
        <span style={{ marginRight: '6px' }}>{isOpen ? '▼' : '▶'}</span>
        <span>{isOpen ? 'Hide Diff' : 'Show Diff'}</span>
      </div>
      
      {isOpen && (
        <div style={{ 
          maxHeight: '300px', 
          overflow: 'auto', 
          fontFamily: 'monospace', 
          fontSize: '12px', 
          background: '#151515',
          borderTop: '1px solid var(--vscode-widget-border, #333)',
          padding: '4px 0'
        }}>
          {diffLines.map((line, idx) => {
            let bgColor = 'transparent';
            let textColor = 'var(--foreground, #ccc)';
            if (line.type === 'added') {
              bgColor = 'rgba(46, 160, 67, 0.15)';
              textColor = '#34d399';
            } else if (line.type === 'removed') {
              bgColor = 'rgba(248, 113, 113, 0.15)';
              textColor = '#f87171';
            }
            return (
              <div key={idx} style={{ 
                display: 'flex', 
                backgroundColor: bgColor, 
                color: textColor,
                lineHeight: '18px',
                padding: '0 8px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}>
                <span style={{ 
                  width: '35px', 
                  userSelect: 'none', 
                  color: 'rgba(255,255,255,0.2)', 
                  textAlign: 'right',
                  paddingRight: '8px',
                  display: 'inline-block'
                }}>
                  {line.type === 'removed' ? line.oldNum : line.type === 'unchanged' ? line.oldNum : ''}
                </span>
                <span style={{ 
                  width: '35px', 
                  userSelect: 'none', 
                  color: 'rgba(255,255,255,0.2)', 
                  textAlign: 'right',
                  paddingRight: '8px',
                  display: 'inline-block'
                }}>
                  {line.type === 'added' ? line.newNum : line.type === 'unchanged' ? line.newNum : ''}
                </span>
                <span style={{ 
                  width: '15px', 
                  userSelect: 'none', 
                  color: line.type === 'added' ? '#34d399' : line.type === 'removed' ? '#f87171' : 'rgba(255,255,255,0.15)',
                  display: 'inline-block'
                }}>
                  {line.prefix}
                </span>
                <span style={{ flex: 1 }}>{line.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Custom code block renderer ────────────────────────────────────────────────
function CodeBlock({ children, className }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g. "language-javascript") and remove 'hljs'
  const lang = (className || '').replace('language-', '').replace(/\bhljs\b/g, '').trim() || 'code';
  const code = String(children).replace(/\n$/, '');
  const lineCount = code.split('\n').length;

  function handleCopy(e) {
    e.stopPropagation();
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="md-code-block">
      <div className="md-code-header" onClick={() => setOpen(o => !o)}>
        <div className="md-code-header-left">
          <div className="md-code-dots">
            <span /><span /><span />
          </div>
          <span className="md-code-lang">{lang}</span>
          {!open && (
            <span className="md-code-preview">
              {lineCount} line{lineCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className="md-code-arrow">{open ? '▾' : '▸'}</span>
        </div>
        <button className="md-copy-btn" onClick={handleCopy}>
          {copied ? '✓ Copied' : '⎘ Copy'}
        </button>
      </div>
      {open && (
        <pre className="md-code-body">
          <code className={className}>{children}</code>
        </pre>
      )}
    </div>
  );
}

// ─── Inline code renderer ─────────────────────────────────────────────────────
function InlineCode({ children }) {
  return <code className="md-inline-code">{children}</code>;
}

// ─── react-markdown component map ────────────────────────────────────────────
const MD_COMPONENTS = {
  code({ node, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const hasNewline = String(children).includes('\n');
    if (!match && !hasNewline) {
      return <InlineCode>{children}</InlineCode>;
    }
    return <CodeBlock className={className} {...props}>{children}</CodeBlock>;
  },
  h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
  ul: ({ children }) => <ul className="md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="md-ol">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
  hr: () => <hr className="md-hr" />,
  p: ({ children }) => <p className="md-p">{children}</p>,
  table: ({ children }) => (
    <div className="md-table-wrapper">
      <table className="md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="md-th">{children}</th>,
  td: ({ children }) => <td className="md-td">{children}</td>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
      {children}
    </a>
  ),
};

// ─── Safe Markdown Preprocessor ───────────────────────────────────────────────
function safeMarkdown(text) {
  if (!text) return "";
  let safeText = text;
  
  // Auto-close unclosed backticks
  const backtickCount = (safeText.match(/```/g) || []).length;
  if (backtickCount % 2 !== 0) {
    safeText += '\n```';
  }
  
  // Sanitize broken HTML that crashes react-markdown
  // E.g. <a href= without closing
  if (safeText.includes('<') && safeText.includes('href=') && !safeText.includes('>')) {
    safeText += '>';
  }
  
  return safeText;
}

// ─── MarkdownRenderer (react-markdown powered) ────────────────────────────────
function MarkdownRenderer({ content, isStreaming }) {
  if (!content) return null;
  const safeContent = safeMarkdown(content);
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={MD_COMPONENTS}
      >
        {safeContent}
      </ReactMarkdown>
      {isStreaming && <span className="streaming-cursor" />}
    </div>
  );
}

// ─── Structured Agent JSON Parser ──────────────────────────────────────────────
function parseStructuredAgentContent(content) {
  if (!content) return null;
  const isJson = content.trim().startsWith('{') || content.includes('```json');
  if (!isJson) return null;

  try {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    let str = match ? match[1] : content.trim();

    if (!match) {
      const firstBrace = str.indexOf('{');
      const lastBrace = str.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        str = str.substring(firstBrace, lastBrace + 1);
      }
    }

    // Fix literal newlines inside JSON strings before parsing
    let inString = false;
    let isEscaped = false;
    let fixedJson = "";
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '"' && !isEscaped) {
        inString = !inString;
        fixedJson += char;
      } else if (char === '\\' && !isEscaped) {
        isEscaped = true;
        fixedJson += char;
      } else {
        if (inString && char === '\n') fixedJson += '\\n';
        else if (inString && char === '\r') fixedJson += '\\r';
        else if (inString && char === '\t') fixedJson += '\\t';
        else fixedJson += char;
        isEscaped = false;
      }
    }

    const parsed = JSON.parse(fixedJson);
    return parsed.ui || null;
  } catch (e) {
    // Streaming fallback: robust regex extraction that doesn't require closing quotes
    const extractUiStr = (key) => {
      const match = content.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`, 'i'));
      return match ? match[1] : null;
    };
    
    let result = [];
    const resultMatch = content.match(/"result"\s*:\s*\[([\s\S]*?)(?:\]|$)/i);
    if (resultMatch) {
      result = resultMatch[1].split(',').map(s => s.replace(/"/g, '').trim()).filter(Boolean);
    }

    return {
      status: extractUiStr('status') || 'in_progress',
      progress: extractUiStr('progress'),
      message: extractUiStr('message'),
      response: extractUiStr('response'),
      next: extractUiStr('next'),
      result: result
    };
  }
}

// ─── Token badge ──────────────────────────────────────────────────────────────
function TokenBadge({ usage }) {
  if (!usage) return null;
  const prompt     = usage.prompt_tokens ?? usage.input_tokens;
  const completion = usage.completion_tokens ?? usage.output_tokens;
  const total      = usage.total_tokens ?? ((prompt || 0) + (completion || 0));
  if (!total) return null;

  return (
    <div className="token-badge">
      <span className="token-badge-icon">🔢</span>
      <span>
        {prompt != null && <><strong>{prompt.toLocaleString()}</strong> in + </>}
        {completion != null && <><strong>{completion.toLocaleString()}</strong> out = </>}
        <strong>{total.toLocaleString()}</strong> tokens
      </span>
    </div>
  );
}

// ─── Main MessageBubble ────────────────────────────────────────────────────────
export default function MessageBubble({
  message,
  messageIndex,
  isLastAssistant,
}) {
  const store = useStore();
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [copied, setCopied] = useState(false);

  const isUser      = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isSystem    = message.role === 'system';
  const isError     = message.isError;
  const isStreaming = message.streaming;

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(message.content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  function handleSaveEdit() {
    if (editText.trim() && store.handleEditAndResend) {
      store.handleEditAndResend(messageIndex, editText.trim());
    }
    setEditMode(false);
  }

  // Strip injected context from user messages for display
  const displayContent = isUser
    ? (message.content || '').replace(/^[\s\S]*?USER REQUEST:\s*/i, '').trim() || message.content
    : message.content;

  const modelBadge = message.model
    ? message.model.split('/').pop()?.split(':')[0]
    : null;

  const structuredData = isAssistant ? parseStructuredAgentContent(message.content) : null;

  function renderToolCard(content) {
    if (!content) return null;
    const lines = content.split('\n');
    const titleLine = lines[0]; 
    
    if (content.includes('[TOOL VERIFICATION]')) {
      return (
        <div className="tool-card verification">
          <div className="tool-card-icon">🛡️</div>
          <div className="tool-card-title">{content.replace('[TOOL VERIFICATION]', '').trim()}</div>
        </div>
      );
    }

    const commandLine = lines.find(l => l.startsWith('Command:')) || '';
    const resultIdx = lines.findIndex(l => l.startsWith('Result:') || l.startsWith('Initial Logs:'));
    const logs = resultIdx !== -1 ? lines.slice(resultIdx + 1).join('\n') : '';
    const isFail = content.includes('Exit Code') && !content.includes('Exit Code 0');

    return (
      <div className={`tool-card ${isFail ? 'fail' : ''}`}>
        <div className="tool-card-header">
          <span className="tool-card-icon">⚙️</span>
          <span className="tool-card-title">
            {commandLine ? commandLine.replace('Command: ', '') : titleLine.replace('[TOOL_RESULT]', '').trim()}
          </span>
          {isFail && <span className="tool-card-badge fail">Failed</span>}
        </div>
        {logs && (
          <div className="tool-card-logs">
            <CodeBlock className="language-sh">{logs}</CodeBlock>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`message timeline-event ${message.role} ${isError ? 'error-bubble' : ''}`}>
      {/* Timeline Track */}
      <div className="timeline-track">
        <div className={`timeline-node ${message.role}`}>
          {isUser ? 'U' : isSystem ? '⚙️' : 'J'}
        </div>
        <div className="timeline-line" />
      </div>

      <div className="timeline-content-wrapper">
        {/* Header */}
        <div className="message-header">
          <div className="message-role-group">
            <span className="message-role">{isUser ? 'You' : isSystem ? 'System' : 'Jarvix'}</span>
            {modelBadge && isAssistant && (
              <span className="message-model-badge">{modelBadge}</span>
            )}
            {isStreaming && (
              <span style={{ fontSize: '10px', color: 'var(--accent)', fontStyle: 'italic' }}>
                ● streaming
              </span>
            )}
          </div>

        {/* Action buttons */}
        <div className="message-actions">
          <button className="msg-action-btn" onClick={handleCopy} title="Copy message">
            {copied ? '✓' : '⎘ Copy'}
          </button>
          {isUser && store.handleEditAndResend && (
            <button
              className="msg-action-btn"
              onClick={() => { setEditText(displayContent); setEditMode(true); }}
              title="Edit & resend"
            >
              ✏️ Edit
            </button>
          )}
          {isLastAssistant && !isStreaming && store.handleRegenerate && (
            <button
              className="msg-action-btn"
              onClick={() => store.handleRegenerate(messageIndex)}
              title="Regenerate response"
            >
              ↺ Retry
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="message-content">
        {editMode ? (
          <>
            <textarea
              className="message-edit-textarea"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus
            />
            <div className="message-edit-actions">
              <button className="edit-save-btn" onClick={handleSaveEdit}>
                ↑ Send
              </button>
              <button className="edit-cancel-btn" onClick={() => setEditMode(false)}>
                Cancel
              </button>
            </div>
          </>
        ) : message.isPlan ? (
          /* Plan view Card -> Inline Roadmap */
          <div className="plan-roadmap-container" style={{ padding: '8px', border: '1px solid var(--vscode-widget-border, #444)', borderRadius: '6px', background: 'var(--vscode-editor-background, #1e1e1e)' }}>
            <div style={{ marginBottom: '12px' }}>
              <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
            </div>
            {message.planStatus === 'pending' && (
              <div className="plan-actions" style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--vscode-widget-border, #444)', paddingTop: '12px' }}>
                <button 
                  className="btn-primary" 
                  style={{ background: '#2ea44f', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                  onClick={() => store.handleApprovePlan(messageIndex)}
                >
                  🚀 Proceed & Implement
                </button>
              </div>
            )}
            {message.planStatus === 'approved' && (
              <div className="plan-status-badge" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderTop: '1px solid var(--vscode-widget-border, #444)', paddingTop: '12px' }}>
                 {store.executionProgress?.runtimeState === 'RUNNING' ? (() => {
                     const steps = Object.values(store.executionProgress.steps || {});
                     const doneCount = steps.filter(s => s.status === 'done' || s.status === 'COMPLETED').length;
                     const runningStep = steps.find(s => s.status === 'running');
                     const total = store.executionProgress.totalSteps || message.planData?.length || '?';
                     const actionLabel = runningStep?.action || runningStep?.tool || 'Initializing...';
                     return (
                       <>
                         <span className="spinner-icon" style={{ display: 'inline-block', animation: 'spin 2s linear infinite' }}>⚙️</span> 
                         <span style={{ fontWeight: 'bold', color: 'var(--vscode-textLink-foreground, #3794ff)' }}>
                           Executing Step {doneCount + 1}/{total}: {actionLabel}
                         </span>
                       </>
                     );
                 })() : store.executionProgress?.runtimeState === 'PAUSED' ? (
                     <>
                       <span>⏸️</span> 
                       <span style={{ fontWeight: 'bold', color: 'var(--vscode-editorWarning-foreground, #cca700)' }}>Paused for file permission. Please review the file changes at the bottom of the chat.</span>
                     </>
                 ) : store.executionProgress?.runtimeState === 'COMPLETED' ? (
                     <>
                       <span>🎉</span> 
                       <span style={{ fontWeight: 'bold', color: '#2ea44f' }}>Plan fully executed!</span>
                     </>
                 ) : (
                   <>
                     <span>✅</span> 
                     <span style={{ fontWeight: 'bold', color: '#2ea44f' }}>Plan Approved. Preparing execution...</span>
                   </>
                 )}
              </div>
            )}
          </div>
        ) : isSystem ? (
          renderToolCard(message.content)
        ) : isUser ? (
          /* User message */
          <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
        ) : structuredData ? (
          /* Structured Agent JSON Response */
          <div className="agent-structured-response" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', padding: '2px 8px', background: 'rgba(124,106,247,0.2)', borderRadius: '12px', color: '#a78bfa' }}>
                  Status: {structuredData.status}
                </span>
                {structuredData.progress && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Progress: {structuredData.progress}
                  </span>
                )}
              </div>
            </div>

            {structuredData.message && (
              <div style={{ padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: '6px', borderLeft: '3px solid #7c6af7' }}>
                <strong>🧠 What I'm doing:</strong> {structuredData.message}
              </div>
            )}

            {structuredData.result && structuredData.result.length > 0 && (
              <div style={{ fontSize: '14px' }}>
                <strong style={{ display: 'block', marginBottom: '6px' }}>✅ Result:</strong>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)' }}>
                  {structuredData.result.map((item, i) => <li key={i}>{item}</li>)}
                </ul>
              </div>
            )}

            {structuredData.response && (
              <div style={{ marginTop: '4px' }}>
                <MarkdownRenderer content={structuredData.response} isStreaming={isStreaming && !structuredData.next} />
              </div>
            )}

            {structuredData.next && (
              <div style={{ fontSize: '14px', marginTop: '4px', color: '#6ee7b7' }}>
                <strong>👉 Next:</strong> {structuredData.next}
              </div>
            )}
          </div>
        ) : (
          /* Assistant message — react-markdown fallback */
          <MarkdownRenderer content={message.content} isStreaming={isStreaming} />
        )}

        {/* ── Pending File Edits (Accept / Decline) ── */}
        {isAssistant && message.fileEdits && message.fileEdits.filter(e => e.status === 'pending').length > 0 && (
          <div className="file-edits-container pending-edits">
            <div className="file-edits-header">
              <div className="file-edits-label">📋 Proposed File Changes</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Review and approve each change
              </div>
            </div>
            {message.fileEdits.map((edit, idx) => {
              if (edit.status !== 'pending') return null;
              const fileName = (edit.filePath || edit.path || '').split(/[/\\]/).pop() || '(unnamed)';
              const isNew = edit.isNew;
              const isDelete = edit.isDelete;
              const actionLabel = isDelete ? '🗑️ Delete' : isNew ? '✨ Create' : '✏️ Edit';
              const actionColor = isDelete ? '#f87171' : isNew ? '#34d399' : '#60a5fa';
              return (
                <div key={idx} className="file-edit-proposal-card" style={{
                  border: '1px solid var(--vscode-widget-border, #444)',
                  borderRadius: '8px',
                  marginBottom: '8px',
                  overflow: 'hidden',
                  background: 'var(--vscode-editor-background, #1e1e1e)',
                }}>
                  {/* File header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--vscode-widget-border, #333)',
                    background: 'rgba(255,255,255,0.03)',
                  }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '10px', background: actionColor + '22', color: actionColor }}>
                      {actionLabel}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '13px', fontFamily: 'monospace' }}>{fileName}</span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {edit.filePath || edit.path}
                    </span>
                  </div>

                  {/* Diff dropdown component */}
                  <DiffViewer 
                    originalCode={edit.originalCode} 
                    newCode={edit.newCode} 
                    isNew={isNew} 
                    isDelete={isDelete} 
                  />

                  {/* Action buttons */}
                  <div style={{
                    display: 'flex', gap: '8px', padding: '8px 12px',
                    borderTop: '1px solid var(--vscode-widget-border, #333)',
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    <button
                      onClick={() => store.handleAcceptFile(messageIndex, idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '5px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                        background: '#2ea44f', color: '#fff', fontWeight: 600, fontSize: '12px',
                      }}
                    >
                      ✅ Accept
                    </button>
                    <button
                      onClick={() => store.handleDeclineFile(messageIndex, idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '5px 14px', borderRadius: '6px', border: '1px solid #f87171', cursor: 'pointer',
                        background: 'transparent', color: '#f87171', fontWeight: 600, fontSize: '12px',
                      }}
                    >
                      ❌ Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Resolved File edits (accepted / declined history) ── */}
        {isAssistant && message.fileEdits && message.fileEdits.filter(e => e.status !== 'pending').length > 0 && (
          <div className="file-edits-container">
            <div className="file-edits-header">
              <div className="file-edits-label">Resolved File Changes</div>
            </div>
            {message.fileEdits.map((edit, idx) => {
              if (edit.status === 'pending') return null;
              return (
                <div
                  key={idx}
                  className="artifact-card diff"
                  onClick={() => store.setActiveWorkspaceView({ type: 'diff', messageIndex, fileIndex: idx })}
                >
                  <div className="artifact-icon">📄</div>
                  <div className="artifact-info">
                    <div className="artifact-title">{(edit.filePath || edit.path || '').split(/[/\\]/).pop() || '(unnamed)'}</div>
                    <div className="artifact-status" style={{ color: edit.status === 'accepted' ? 'var(--success)' : 'var(--danger)' }}>
                      {edit.status}
                    </div>
                  </div>
                  {edit.status === 'declined' && store.handleUndoDeclineFile && (
                    <button
                      className="batch-btn accept"
                      style={{ marginLeft: 'auto', marginRight: '10px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        store.handleUndoDeclineFile(messageIndex, idx);
                      }}
                    >
                      ↩ Undo
                    </button>
                  )}
                  <div className="artifact-arrow">→</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Suggested commands */}
        {isAssistant && message.suggestedCommands && message.suggestedCommands.length > 0 && (
          <div className="suggested-commands-container">
            {message.suggestedCommands.map((cmd, idx) => (
              <CommandPermissionViewer
                key={idx}
                cmd={cmd}
                onAccept={() => store.handleAcceptCommand(messageIndex, idx)}
                onDecline={() => store.handleDeclineCommand(messageIndex, idx)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
  );
}