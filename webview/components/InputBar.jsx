import { useState, useRef, useEffect, useCallback } from 'react';

const MAX_CHARS = 10000;

export default function InputBar({ onSend, onStop, isLoading, workspaceFiles = [] }) {
  const [text, setText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]); // { path: string, name: string }
  const [attachedImages, setAttachedImages] = useState([]); // { name, base64, mimeType }

  // @ mention state
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionCaret, setMentionCaret] = useState(0); // position of @ in the text

  const textareaRef = useRef(null);
  const mentionRef = useRef(null);

  // ── Derived file list filtered by mentionQuery ────────────────────────────
  const filteredFiles = workspaceFiles
    .filter(f => f.type === 'file')
    .filter(f =>
      !mentionQuery || f.path.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      f.name.toLowerCase().includes(mentionQuery.toLowerCase())
    )
    .slice(0, 10);

  // ── Handle textarea keypresses ────────────────────────────────────────────
  function handleKeyDown(e) {
    if (mentionOpen) {
      if (e.key === 'Escape') { setMentionOpen(false); return; }
      if (e.key === 'Enter' && !e.shiftKey && filteredFiles.length > 0) {
        e.preventDefault();
        pickMentionFile(filteredFiles[0]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleChange(e) {
    const val = e.target.value;
    setText(val);

    // Detect @ mention
    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');

    if (atIdx !== -1) {
      const query = before.slice(atIdx + 1);
      // Only open if there's no space after the @
      if (!query.includes(' ')) {
        setMentionQuery(query);
        setMentionCaret(atIdx);
        setMentionOpen(true);
        return;
      }
    }
    setMentionOpen(false);
  }

  function pickMentionFile(file) {
    // Replace the @query with nothing in the text (the file becomes a pill tag)
    const before = text.slice(0, mentionCaret);
    const after = text.slice(mentionCaret + 1 + mentionQuery.length);
    setText(before + after);
    setMentionOpen(false);
    setMentionQuery('');

    // Add pill only if not already attached
    if (!attachedFiles.some(f => f.path === file.path)) {
      setAttachedFiles(prev => [...prev, { path: file.path, name: file.name }]);
    }
    textareaRef.current?.focus();
  }

  function removeFile(filePath) {
    setAttachedFiles(prev => prev.filter(f => f.path !== filePath));
  }

  function removeImage(idx) {
    setAttachedImages(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Image attachment: drag & drop ─────────────────────────────────────────
  function handleDrop(e) {
    e.preventDefault();
    processImageFiles(e.dataTransfer.files);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  // ── Image attachment: paste ────────────────────────────────────────────────
  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let hasImage = false;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        hasImage = true;
        const file = item.getAsFile();
        if (file) readImageFile(file);
      }
    }
    // Don't prevent default so text still pastes normally
  }

  function processImageFiles(fileList) {
    for (const file of fileList) {
      if (file.type.startsWith('image/')) {
        readImageFile(file);
      }
    }
  }

  function readImageFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result; // data:<mime>;base64,<data>
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type;
      setAttachedImages(prev => [...prev, { name: file.name, base64, mimeType, preview: dataUrl }]);
    };
    reader.readAsDataURL(file);
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  function handleSend() {
    if (!text.trim() || isLoading) return;
    onSend({
      text: text.trim(),
      explicitFiles: attachedFiles.map(f => f.path),
      attachedImages: attachedImages.map(({ name, base64, mimeType }) => ({ name, base64, mimeType })),
    });
    setText('');
    setAttachedFiles([]);
    setAttachedImages([]);
    setMentionOpen(false);
  }

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  function handleInput(e) {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
  }

  // Close mention dropdown on outside click
  useEffect(() => {
    function onClickOutside(e) {
      if (mentionRef.current && !mentionRef.current.contains(e.target)) {
        setMentionOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const charCount = text.length;
  const isOverLimit = charCount > MAX_CHARS;
  const hasAttachments = attachedFiles.length > 0 || attachedImages.length > 0;

  return (
    <div
      className="input-bar-wrapper"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Attachment pills (files) */}
      {attachedFiles.length > 0 && (
        <div className="attachment-pills">
          {attachedFiles.map(f => (
            <div key={f.path} className="attachment-pill file-pill" title={f.path}>
              <span className="pill-icon">📄</span>
              <span className="pill-name">{f.name}</span>
              <button className="pill-remove" onClick={() => removeFile(f.path)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Image thumbnails */}
      {attachedImages.length > 0 && (
        <div className="attachment-pills">
          {attachedImages.map((img, i) => (
            <div key={i} className="attachment-pill image-pill" title={img.name}>
              <img src={img.preview} alt={img.name} className="pill-thumb" />
              <span className="pill-name">{img.name}</span>
              <button className="pill-remove" onClick={() => removeImage(i)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      {/* @ mention dropdown */}
      {mentionOpen && filteredFiles.length > 0 && (
        <div className="mention-dropdown" ref={mentionRef}>
          <div className="mention-header">📎 Attach file</div>
          {filteredFiles.map(f => (
            <div
              key={f.path}
              className="mention-item"
              onMouseDown={(e) => { e.preventDefault(); pickMentionFile(f); }}
              title={f.path}
            >
              <span className="mention-item-icon">📄</span>
              <span className="mention-item-name">{f.name}</span>
              <span className="mention-item-path">{f.path}</span>
            </div>
          ))}
        </div>
      )}

      <div className="input-bar">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onInput={handleInput}
          placeholder={`Ask Jarvix anything…  Type @ to attach a file  (Enter to send, Shift+Enter for new line)`}
          rows={1}
          disabled={isLoading}
          style={{ height: 'auto', opacity: isLoading ? 0.6 : 1 }}
        />
        <div className="input-bar-actions">
          {isLoading ? (
            <button
              className="stop-btn"
              onClick={onStop}
              title="Stop generation"
            >
              ⏹ Stop
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!text.trim() || isOverLimit}
            >
              ↑ Send
            </button>
          )}
        </div>
      </div>

      <div className="input-bar-footer">
        <span className="input-hint">
          {hasAttachments
            ? `${attachedFiles.length > 0 ? `${attachedFiles.length} file${attachedFiles.length > 1 ? 's' : ''}` : ''}${attachedFiles.length > 0 && attachedImages.length > 0 ? ' + ' : ''}${attachedImages.length > 0 ? `${attachedImages.length} image${attachedImages.length > 1 ? 's' : ''}` : ''} attached`
            : 'Type @ to attach a file  •  Drag & drop or paste images'
          }
        </span>
        <span className={`char-count ${isOverLimit ? 'warn' : ''}`}>
          {charCount > 0 ? `${charCount.toLocaleString()}${isOverLimit ? ` / ${MAX_CHARS.toLocaleString()} ⚠️` : ''}` : ''}
        </span>
      </div>
    </div>
  );
}