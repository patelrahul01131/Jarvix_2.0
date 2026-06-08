/**
 * Terminal execution tool.
 * Evaluates shell commands and returns structured outputs (stdout, stderr, exitCode).
 */

const { exec } = require("child_process");

function executeTerminalCommand({ command, cwd }) {
  return new Promise((resolve) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      resolve({
        success: !error,
        stdout: stdout || "",
        stderr: stderr || (error ? error.message : ""),
        exitCode: error ? error.code : 0
      });
    });
  });
}

module.exports = { executeTerminalCommand };
