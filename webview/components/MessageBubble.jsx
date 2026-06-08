import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import FileDiffViewer from './FileDiffViewer';
import CommandPermissionViewer from './CommandPermissionViewer';

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
    // Streaming fallback: simple regex extraction for UI part
    const extractUiStr = (key) => {
      const match = content.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, 'i'));
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
  onApplyCode,
  onAcceptFile,
  onDeclineFile,
  onAcceptAllFiles,
  onDeclineAllFiles,
  onAcceptCommand,
  onDeclineCommand,
  onApprovePlan,
  onEdit,
  onRegenerate,
  onViewDiff,
}) {
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState(message.content || '');
  const [copied, setCopied] = useState(false);

  const isUser      = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isError     = message.isError;
  const isStreaming = message.streaming;

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(message.content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  function handleSaveEdit() {
    if (editText.trim() && onEdit) {
      onEdit(messageIndex, editText.trim());
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

  return (
    <div className={`message ${message.role} ${isError ? 'error-bubble' : ''}`}>
      {/* Header */}
      <div className="message-header">
        <div className="message-role-group">
          <div className="message-avatar">
            {isUser ? 'U' : 'J'}
          </div>
          <span className="message-role">{isUser ? 'You' : 'Jarvix'}</span>
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
          {isUser && onEdit && (
            <button
              className="msg-action-btn"
              onClick={() => { setEditText(displayContent); setEditMode(true); }}
              title="Edit & resend"
            >
              ✏️ Edit
            </button>
          )}
          {isLastAssistant && !isStreaming && onRegenerate && (
            <button
              className="msg-action-btn"
              onClick={() => onRegenerate(messageIndex)}
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
          /* Plan view */
          <div className="implementation-plan-container">
            <div className="plan-header">
              <div className="plan-title">📋 Implementation Plan</div>
              {message.planStatus === 'approved'
                ? <span className="plan-status-approved">✅ Approved</span>
                : <span className="plan-status-pending">⏳ Awaiting Review</span>
              }
            </div>

            {message.planData && Array.isArray(message.planData) && message.planData.length > 0 && (
              <div className="plan-steps-list" style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {message.planData.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '8px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--accent)' }}>{idx + 1}.</span>
                    <span>{step.action}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                      {step.tool}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <MarkdownRenderer content={message.content} />

            {message.planStatus !== 'approved' && onApprovePlan && (
              <div style={{ marginTop: '14px', borderTop: '1px solid rgba(124,106,247,0.15)', paddingTop: '12px' }}>
                <button
                  className="plan-approve-btn"
                  onClick={() => onApprovePlan(messageIndex)}
                >
                  🚀 Approve & Execute Plan
                </button>
                <div className="plan-approve-hint">
                  Or type feedback below to refine the plan.
                </div>
              </div>
            )}
          </div>
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

        {/* File edits */}
        {isAssistant && message.fileEdits && message.fileEdits.length > 0 && (
          <div className="file-edits-container">
            <div className="file-edits-header">
              <div className="file-edits-label">File Changes</div>
              {message.fileEdits.some(e => e.status === 'pending') && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button className="batch-btn accept" onClick={() => onAcceptAllFiles(messageIndex)}>
                    Accept All
                  </button>
                  <button className="batch-btn decline" onClick={() => onDeclineAllFiles(messageIndex)}>
                    Decline All
                  </button>
                </div>
              )}
            </div>
            {message.fileEdits.map((edit, idx) => (
              <FileDiffViewer
                key={idx}
                edit={edit}
                onAccept={(editedCode) => onAcceptFile(messageIndex, idx, editedCode)}
                onDecline={() => onDeclineFile(messageIndex, idx)}
                onViewDiff={() => onViewDiff(messageIndex, idx)}
              />
            ))}
          </div>
        )}

        {/* Suggested commands */}
        {isAssistant && message.suggestedCommands && message.suggestedCommands.length > 0 && (
          <div className="suggested-commands-container">
            {message.suggestedCommands.map((cmd, idx) => (
              <CommandPermissionViewer
                key={idx}
                cmd={cmd}
                onAccept={() => onAcceptCommand(messageIndex, idx)}
                onDecline={() => onDeclineCommand(messageIndex, idx)}
              />
            ))}
          </div>
        )}

        {/* Token badge */}
        {isAssistant && !isStreaming && (
          <TokenBadge usage={message.tokenUsage} />
        )}
      </div>
    </div>
  );
}