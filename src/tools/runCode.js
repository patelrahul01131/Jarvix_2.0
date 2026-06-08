/**
 * Run Code tool placeholder.
 * Will support executing code in sandboxes (e.g. Python, Node scripts)
 */

function executeRunCode({ language, code }) {
  // TODO: implement sandboxed execution
  return {
    success: false,
    stdout: "",
    stderr: "run_code is currently a placeholder",
    exitCode: 1
  };
}

module.exports = { executeRunCode };
