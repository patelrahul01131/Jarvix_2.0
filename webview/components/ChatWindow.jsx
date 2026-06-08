import { useRef, useEffect } from 'react';
import { Virtuoso } from 'react-virtuoso';
import MessageBubble from './MessageBubble';
import AgentStatusPanel from './AgentStatusPanel';

export default function ChatWindow({
  messages,
  isLoading,
  onApplyCode,
  statusHistory,
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
  streamingMessage,   // { content, sessionId } — isolated streaming state
  activeSessionId,
}) {
  const virtuosoRef = useRef(null);

  // Find the last assistant message index for showing Regenerate
  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // Auto-scroll to bottom when new messages arrive or streaming updates
  useEffect(() => {
    if (virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
    }
  }, [messages.length]);

  // Scroll during streaming too
  useEffect(() => {
    if (streamingMessage && virtuosoRef.current) {
      virtuosoRef.current.scrollToIndex({ index: messages.length, behavior: 'smooth' });
    }
  }, [streamingMessage]);

  if (!messages.length && !isLoading) {
    return (
      <div className="chat-window">
        <div className="empty-state">
          <div className="icon">⚡</div>
          <div className="empty-state-title">Jarvix is ready</div>
          <div className="empty-state-sub">Pick a model and ask anything</div>
        </div>
      </div>
    );
  }

  // Filter out system messages, but retain their original index
  const displayItems = messages
    .map((msg, index) => ({ msg, index }))
    .filter(item => item.msg.role !== 'system');

  // Build the full list of items to render.
  // The streaming bubble is rendered as a separate final item while active.
  const totalCount = displayItems.length + (isLoading ? 1 : 0);

  function itemContent(index) {
    // The loading/streaming item
    if (index === displayItems.length) {
      // Show streaming content if available
      if (streamingMessage && streamingMessage.sessionId === activeSessionId) {
        return (
          <MessageBubble
            key="streaming"
            message={{ role: 'assistant', content: streamingMessage.content, streaming: true }}
            messageIndex={-1}
            isLastAssistant={false}
            onApplyCode={onApplyCode}
            onAcceptFile={onAcceptFile}
            onDeclineFile={onDeclineFile}
            onAcceptAllFiles={onAcceptAllFiles}
            onDeclineAllFiles={onDeclineAllFiles}
            onAcceptCommand={onAcceptCommand}
            onDeclineCommand={onDeclineCommand}
            onApprovePlan={onApprovePlan}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onViewDiff={onViewDiff}
          />
        );
      }

      // No streaming content yet — show agent status panel
      return (
        <div className="message assistant">
          <div className="avatar assistant-avatar">⚡</div>
          <div className="message-content" style={{ width: '100%' }}>
            <AgentStatusPanel statusHistory={statusHistory} isLoading={isLoading} />
          </div>
        </div>
      );
    }

    const { msg, index: origIndex } = displayItems[index];
    return (
      <MessageBubble
        key={origIndex}
        message={msg}
        messageIndex={origIndex}
        isLastAssistant={origIndex === lastAssistantIdx && !isLoading}
        onApplyCode={onApplyCode}
        onAcceptFile={onAcceptFile}
        onDeclineFile={onDeclineFile}
        onAcceptAllFiles={onAcceptAllFiles}
        onDeclineAllFiles={onDeclineAllFiles}
        onAcceptCommand={onAcceptCommand}
        onDeclineCommand={onDeclineCommand}
        onApprovePlan={onApprovePlan}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
        onViewDiff={onViewDiff}
      />
    );
  }

  return (
    <div className="chat-window">
      <Virtuoso
        ref={virtuosoRef}
        style={{ flex: 1, height: '100%' }}
        totalCount={totalCount}
        itemContent={itemContent}
        followOutput="smooth"
        alignToBottom
        increaseViewportBy={{ top: 300, bottom: 300 }}
        overscan={5}
      />
    </div>
  );
}