/**
 * Process Manager Node
 * Tracks long-running background tasks (e.g., dev servers)
 * allowing the agent to run them autonomously without blocking.
 */

const { spawn } = require('child_process');

class ProcessManager {
  constructor() {
    this.processes = new Map();
  }

  startProcess(cmd, args, options, workspaceRoot) {
    const processId = `${cmd}_${Date.now()}`;
    const child = spawn(cmd, args, { cwd: workspaceRoot, shell: process.platform === "win32" });

    const procInfo = {
      pid: child.pid,
      id: processId,
      command: `${cmd} ${args.join(' ')}`,
      status: 'running',
      health: 'healthy',
      startedAt: Date.now(),
      lastOutputAt: Date.now(),
      restartCount: 0,
      logs: []
    };

    child.stdout.on('data', (data) => {
      procInfo.logs.push(data.toString());
      procInfo.lastOutputAt = Date.now();
      if (procInfo.logs.length > 500) procInfo.logs.shift(); // keep last 500 lines
    });

    child.stderr.on('data', (data) => {
      procInfo.logs.push(`[STDERR] ${data.toString()}`);
      procInfo.lastOutputAt = Date.now();
      if (procInfo.logs.length > 500) procInfo.logs.shift();
      
      // Simple health check heuristic
      if (data.toString().toLowerCase().includes('error')) {
         procInfo.health = 'error';
      }
    });

    child.on('close', (code) => {
      procInfo.status = 'exited';
      procInfo.health = code === 0 ? 'healthy' : 'error';
      procInfo.exitCode = code;
    });

    this.processes.set(processId, procInfo);
    return procInfo;
  }

  getLogs(processId) {
    const proc = this.processes.get(processId);
    return proc ? proc.logs.join('\n') : "Process not found.";
  }

  getProcessInfo(processId) {
     return this.processes.get(processId);
  }

  getAllProcesses() {
    return Array.from(this.processes.values());
  }

  killProcess(processId) {
    const proc = this.processes.get(processId);
    if (proc && proc.status === 'running') {
      try {
        process.kill(proc.pid);
        proc.status = 'killed';
        return true;
      } catch (err) {
        console.error(`Failed to kill process ${processId}:`, err);
        return false;
      }
    }
    return false;
  }
}

// Global Singleton for the lifecycle of the IDE/Server
const globalProcessManager = new ProcessManager();

module.exports = { ProcessManager, globalProcessManager };
