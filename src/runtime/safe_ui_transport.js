/**
 * Safe UI Transport
 * Prevents "Webview is disposed" errors by validating the panel state
 * before attempting to send messages.
 */

class SafeUITransport {
  constructor(panel = null) {
    this.panel = panel;
  }

  setPanel(panel) {
    this.panel = panel;
  }

  send(message) {
    if (!this.panel) {
      console.warn("[SafeUITransport] Attempted to send message, but no panel is attached.", message);
      return false;
    }

    // Protect against 'Webview is disposed' errors
    if (this.panel.disposed) {
       console.warn("[SafeUITransport] Attempted to send message, but webview is disposed.", message);
       return false;
    }

    try {
      this.panel.webview.postMessage(message);
      return true;
    } catch (err) {
      console.error("[SafeUITransport] Failed to post message:", err);
      return false;
    }
  }

  // Helper methods for common message types
  sendChunk(content) {
    return this.send({ type: "chunk", content });
  }

  sendStatus(status) {
    return this.send({ type: "status", status });
  }
}

const uiTransport = new SafeUITransport();

module.exports = { SafeUITransport, uiTransport };
