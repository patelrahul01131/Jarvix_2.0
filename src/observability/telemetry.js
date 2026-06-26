const fs = require("fs");
const path = require("path");

/**
 * @typedef {Object} TelemetryMetrics
 * @property {number} goal_extraction_time
 * @property {number} memory_retrieval_time
 * @property {number} planning_time
 * @property {number} execution_time
 * @property {number} prompt_tokens
 * @property {number} completion_tokens
 * @property {number} retrieved_memories
 * @property {number} selected_skills
 * @property {boolean} task_success
 */

const { getWorkspaceRoot } = require("../tools/fileSystem");

class Telemetry {
  constructor() {}

  getLogsDir() {
    const root = getWorkspaceRoot() || process.cwd();
    return path.join(root, ".jarvix", "telemetry");
  }

  /**
   * Records a complete task execution telemetry payload
   * @param {string} sessionId
   * @param {Partial<TelemetryMetrics>} metrics
   */
  logTask(sessionId, metrics) {
    const defaultMetrics = {
      goal_extraction_time: 0,
      memory_retrieval_time: 0,
      planning_time: 0,
      execution_time: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      retrieved_memories: 0,
      selected_skills: 0,
      task_success: false,
    };

    const finalMetrics = {
      ...defaultMetrics,
      ...metrics,
      timestamp: Date.now(),
      sessionId,
    };

    const logsDir = this.getLogsDir();
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(
      logsDir,
      `telemetry_${new Date().toISOString().split("T")[0]}.jsonl`,
    );
    fs.appendFileSync(logPath, JSON.stringify(finalMetrics) + "\n");
    console.log(`[Telemetry] Logged metrics for session ${sessionId}`);
  }
}

const telemetry = new Telemetry();
module.exports = { telemetry, Telemetry };
