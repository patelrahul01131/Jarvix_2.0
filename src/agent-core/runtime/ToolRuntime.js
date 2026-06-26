// src/agent-core/runtime/ToolRuntime.js
const { ExecutionResult } = require("../domain/Models");

class ToolRuntime {
  constructor(options = {}) {
    this.telemetry = options.telemetry;
    this.permMgr = options.permissionManager;
  }

  async execute(toolFn, args, cancellationToken, options = {}) {
    const startTime = Date.now();
    const timeoutMs = options.timeout || 30000;
    const maxRetries = options.maxRetries || 1;
    let attempt = 0;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`TOOL_EXECUTION_TIMEOUT: Tool execution exceeded timeout limit of ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    const runWithRetry = async () => {
      while (attempt < maxRetries) {
        attempt++;
        if (cancellationToken && cancellationToken.isCancelled) {
          throw new Error("TOOL_EXECUTION_CANCELLED: Execution was cancelled by caller.");
        }

        try {
          // Stream output hook if provided
          if (options.onChunk && args.onChunk) {
            // wire chunks
          }

          const result = await toolFn(args);
          return result;
        } catch (err) {
          if (attempt >= maxRetries) {
            throw err;
          }
          console.warn(`[ToolRuntime] Tool execution failed. Retrying (attempt ${attempt + 1}/${maxRetries}). Error: ${err.message}`);
          await new Promise(r => setTimeout(r, options.backoffMs || 1000));
        }
      }
    };

    try {
      const result = await Promise.race([runWithRetry(), timeoutPromise]);
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      return new ExecutionResult({
        success: true,
        output: result,
        error: null,
        duration,
        metrics: { attempt, timeoutMs }
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      return new ExecutionResult({
        success: false,
        output: null,
        error: err.message,
        duration,
        metrics: { attempt, timeoutMs }
      });
    }
  }
}

class CancellationToken {
  constructor() {
    this.isCancelled = false;
    this.listeners = [];
  }

  cancel() {
    if (this.isCancelled) return;
    this.isCancelled = true;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {}
    }
  }

  onCancel(listener) {
    if (this.isCancelled) {
      listener();
    } else {
      this.listeners.push(listener);
    }
  }
}

module.exports = { ToolRuntime, CancellationToken };
