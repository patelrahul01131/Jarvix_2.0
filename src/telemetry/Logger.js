const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('../tools/fileSystem');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  static level = LOG_LEVELS.INFO;
  static logFile = null;

  static init() {
    try {
      const root = getWorkspaceRoot();
      if (root) {
        const logDir = path.join(root, '.jarvix', 'logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        this.logFile = path.join(logDir, `jarvix_${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
      }
    } catch (e) {
      // fallback if no workspace
    }
  }

  static setLevel(levelName) {
    if (LOG_LEVELS[levelName] !== undefined) {
      this.level = LOG_LEVELS[levelName];
    }
  }

  static _write(level, module, message, data = null) {
    if (LOG_LEVELS[level] < this.level) return;

    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | Data: ${JSON.stringify(data)}` : '';
    const logLine = `[${timestamp}] [${level}] [${module}] ${message}${dataStr}`;

    // Write to console
    if (level === 'ERROR') {
      console.error(logLine);
    } else if (level === 'WARN') {
      console.warn(logLine);
    } else if (level === 'DEBUG') {
      console.debug(logLine);
    } else {
      console.log(logLine);
    }

    // Write to file
    if (this.logFile) {
      fs.appendFile(this.logFile, logLine + '\n', (err) => {
        if (err) console.error('Failed to write to log file:', err.message);
      });
    }
  }

  static debug(module, message, data) { this._write('DEBUG', module, message, data); }
  static info(module, message, data) { this._write('INFO', module, message, data); }
  static warn(module, message, data) { this._write('WARN', module, message, data); }
  static error(module, message, data) { this._write('ERROR', module, message, data); }
}

module.exports = { Logger };
