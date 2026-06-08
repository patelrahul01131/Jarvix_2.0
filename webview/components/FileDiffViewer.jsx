import { useState, useCallback } from 'react';

function computeDiff(oldStr, newStr) {
  const oldLines = oldStr ? oldStr.split(/\r?\n/) : [];
  const newLines = newStr ? newStr.split(/\r?\n/) : [];
  
  const dp = Array(oldLines.length + 1).fill(null).map(() => Array(newLines.length + 1).fill(0));
  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  const diff = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'unchanged', text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }
  return diff;
}

export default function FileDiffViewer({ edit, onAccept, onDecline, onViewDiff }) {
  const { filePath, isNew, isDelete, originalCode, newCode } = edit;
  const [isExpanded, setIsExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editedCode, setEditedCode] = useState(newCode || '');

  // Recompute diff against (possibly user-edited) code
  const displayCode = editMode ? editedCode : newCode;
  const diffLines = isDelete ? [] : computeDiff(originalCode, displayCode);
  const addedCount = diffLines.filter(l => l.type === 'added').length;
  const removedCount = diffLines.filter(l => l.type === 'removed').length;

  function handleAccept() {
    // Pass the (possibly user-edited) code to the accept handler
    onAccept(editMode ? editedCode : undefined);
  }

  function toggleEditMode() {
    if (!editMode) {
      setEditedCode(newCode || '');
      setIsExpanded(true); // Auto-expand when entering edit mode
    }
    setEditMode(e => !e);
  }

  return (
    <div style={{
      border: '1px solid var(--vscode-widget-border, #444)',
      borderRadius: '6px',
      margin: '12px 0',
      background: 'var(--vscode-editor-background, #1e1e1e)',
      overflow: 'hidden',
      fontFamily: 'var(--vscode-editor-font-family, Consolas, monospace)'
    }}>
      {/* Header row */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '8px 12px',
          background: 'var(--vscode-sideBar-background, #252526)',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          userSelect: 'none',
          borderBottom: isExpanded ? '1px solid var(--vscode-widget-border, #444)' : 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
          <span style={{ fontSize: '14px' }}>{isExpanded ? '▼' : '▶'}</span>
          <span style={{
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '4px',
            fontWeight: 'bold',
            background: isDelete ? '#f85149' : (isNew ? '#2ea44f' : '#0969da'),
            color: '#fff'
          }}>
            {isDelete ? 'DELETE' : (isNew ? 'NEW' : 'MODIFIED')}
          </span>
          <span style={{
            fontSize: '13px',
            color: 'var(--vscode-foreground, #cccccc)',
            fontWeight: '500',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {filePath}
          </span>
          {!isNew && (addedCount > 0 || removedCount > 0) && (
            <span style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
              {addedCount > 0 && (
                <span style={{ fontSize: '10px', color: '#3fb950', fontWeight: 'bold', background: 'rgba(46,164,79,0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                  +{addedCount}
                </span>
              )}
              {removedCount > 0 && (
                <span style={{ fontSize: '10px', color: '#f85149', fontWeight: 'bold', background: 'rgba(248,81,73,0.15)', padding: '1px 5px', borderRadius: '3px' }}>
                  -{removedCount}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }} onClick={e => e.stopPropagation()}>
          {edit.status === 'pending' && !isDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); toggleEditMode(); }}
              title={editMode ? 'Back to diff view' : 'Edit before accepting'}
              style={{
                background: editMode ? '#6e40c9' : 'transparent',
                color: editMode ? '#fff' : 'var(--vscode-descriptionForeground, #888)',
                border: '1px solid var(--vscode-widget-border, #444)',
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {editMode ? '✏️ Editing' : '✏️ Edit'}
            </button>
          )}
          {edit.status === 'pending' && !isDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewDiff(); }}
              title="Open native VS Code diff view"
              style={{
                background: 'transparent',
                color: 'var(--vscode-textLink-foreground, #3794ff)',
                border: '1px solid var(--vscode-widget-border, #444)',
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              👁️ View Diff
            </button>
          )}
          {edit.status === 'pending' && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleAccept(); }}
                style={{
                  background: '#2ea44f',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                {editMode ? 'Accept Edit' : 'Accept'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditMode(false); onDecline(); }}
                style={{
                  background: '#f85149',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '3px 8px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Decline
              </button>
            </>
          )}
          {edit.status === 'accepted' && (
            <span style={{ color: '#2ea44f', fontSize: '12px', fontWeight: 'bold' }}>✓ Accepted</span>
          )}
          {edit.status === 'declined' && (
            <span style={{ color: '#f85149', fontSize: '12px', fontWeight: 'bold' }}>✗ Declined</span>
          )}
          {edit.status === 'error' && (
            <span style={{ color: '#f85149', fontSize: '12px', fontWeight: 'bold' }}>⚠️ Failed</span>
          )}
          <span style={{ fontSize: '12px', color: 'var(--vscode-descriptionForeground, #888)', marginLeft: '4px' }}>
            {isExpanded ? 'Hide' : 'Show'}
          </span>
        </div>
      </div>
      
      {/* Error message */}
      {edit.status === 'error' && isExpanded && (
        <div style={{
          padding: '8px 12px',
          background: 'rgba(248, 81, 73, 0.1)',
          color: '#f85149',
          borderBottom: '1px solid var(--vscode-widget-border, #444)',
          fontSize: '12px',
          whiteSpace: 'pre-wrap',
          fontFamily: 'var(--vscode-editor-font-family, Consolas, monospace)'
        }}>
          <strong>Error applying changes:</strong> {edit.error || "Could not find exact block to replace."}
        </div>
      )}

      {/* Inline edit mode — textarea */}
      {isExpanded && editMode && (
        <div style={{ padding: '8px', borderBottom: '1px solid var(--vscode-widget-border, #444)' }}>
          <div style={{ fontSize: '11px', color: 'var(--vscode-descriptionForeground, #888)', marginBottom: '6px' }}>
            ✏️ Edit the code below before accepting. Changes are reflected live in the diff view.
          </div>
          <textarea
            value={editedCode}
            onChange={e => setEditedCode(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: '200px',
              maxHeight: '400px',
              background: 'var(--vscode-editor-background, #1e1e1e)',
              color: 'var(--vscode-editor-foreground, #d4d4d4)',
              border: '1px solid #6e40c9',
              borderRadius: '4px',
              fontFamily: 'var(--vscode-editor-font-family, Consolas, monospace)',
              fontSize: '12px',
              lineHeight: '1.5',
              padding: '8px',
              resize: 'vertical',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Diff view */}
      <div style={{
        display: isExpanded ? 'block' : 'none',
        maxHeight: editMode ? '200px' : '450px',
        overflowY: 'auto',
        fontSize: '12px',
        lineHeight: '1.6',
        padding: '4px 0'
      }}>
        {editMode && (
          <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--vscode-descriptionForeground, #888)', borderBottom: '1px solid rgba(110,64,201,0.2)' }}>
            Live preview of your edits vs original:
          </div>
        )}
        {diffLines.map((line, idx) => {
          const isAdded = line.type === 'added';
          const isRemoved = line.type === 'removed';
          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                background: isAdded
                  ? 'rgba(46, 164, 79, 0.18)'
                  : isRemoved
                  ? 'rgba(248, 81, 73, 0.18)'
                  : 'transparent',
                borderLeft: isAdded
                  ? '3px solid #3fb950'
                  : isRemoved
                  ? '3px solid #f85149'
                  : '3px solid transparent',
                padding: '1px 10px 1px 8px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all'
              }}
            >
              <span style={{
                width: '18px',
                fontWeight: 'bold',
                color: isAdded ? '#3fb950' : isRemoved ? '#f85149' : '#555',
                userSelect: 'none',
                flexShrink: 0,
                display: 'inline-block'
              }}>
                {isAdded ? '+' : isRemoved ? '-' : ' '}
              </span>
              <span style={{
                color: isAdded
                  ? '#b5f0c0'
                  : isRemoved
                  ? '#ffa5a0'
                  : 'var(--vscode-editor-foreground, #d4d4d4)',
                flex: 1
              }}>{line.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
