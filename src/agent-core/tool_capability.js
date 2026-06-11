/**
 * Tool Capability Node
 * Provides strict operational limits and metadata for tools
 * to the planner before generation.
 */

function buildToolCapabilityContext() {
  const capabilityRegistry = {
    "terminal.exec": {
      description: "Execute a single command line utility. To run in a specific directory, provide the 'cwd' property. Do NOT chain commands like 'cd foo && npm install'—instead, set cmd: 'npm', args: ['install'], cwd: 'foo'.",
      allowedCommands: ["npm", "node", "git", "npx"],
      blockedCommands: ["cmd", "powershell", "bash", "mkdir", "rm", "cp", "mv"],
      cannotCreateDirectories: true,
      requiresApproval: false,
      riskLevel: "medium"
    },
    "fs.writeFile": {
      description: "Write raw text content to a new file. Parent directories are automatically created if they don't exist. Do not use terminal commands like mkdir.",
      requiresApproval: true,
      riskLevel: "medium"
    },
    "fs.editFile": {
      description: "Replace text between specific line numbers in an existing file.",
      requiresApproval: true,
      riskLevel: "medium"
    },
    "fs.deleteFile": {
       description: "Delete an existing file.",
       requiresApproval: true,
       riskLevel: "high"
    },
    "fs.readFile": {
      description: "Read the full text content of a file.",
      requiresApproval: false,
      riskLevel: "low"
    },
    "list_dir": {
      description: "List the contents of a directory.",
      requiresApproval: false,
      riskLevel: "low"
    },
    "grep_search": {
      description: "Search for a pattern across files.",
      requiresApproval: false,
      riskLevel: "low"
    }
  };

  return capabilityRegistry;
}

async function runToolCapabilityNode(state, args) {
  if (args.onStatus) {
    args.onStatus(`[${new Date().toLocaleTimeString()}] ⚙️ Loading Tool Capabilities...`);
  }

  const capabilities = buildToolCapabilityContext();

  return {
    toolCapabilities: capabilities
  };
}

module.exports = { runToolCapabilityNode, buildToolCapabilityContext };
