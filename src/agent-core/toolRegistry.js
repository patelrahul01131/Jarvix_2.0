// src/agent-core/toolRegistry.js
/**
 * Single Source of Truth Tool Registry
 * Defines exact capabilities, schemas, and runtime execution constraints.
 */

const TOOL_REGISTRY = {
  "terminal.exec": {
    description: "Run safe CLI commands. You must provide the base command and an array of arguments. NEVER wrap commands in 'cmd.exe', 'powershell', or 'bash'. Just use the base command directly (e.g., cmd='npm', args=['init', '-y']).",
    schema: {
      cmd: "string", // Must be one of allowedCommands
      args: "array", // Array of string arguments
      cwd: "string?", // Optional relative path to run the command in
    },
    allowedCommands: ["npm", "node", "git", "npx"],
    cannotCreateDirectories: true,
    risk: "medium",
  },
  "fs.createDirectory": {
    description: "Create a new directory (and any necessary parent directories).",
    schema: {
      path: "string" // Relative path to create
    },
    risk: "low"
  },
  "scaffold_project": {
    description: "Initialize a new project using standard templates without manually running shell scripts. Supported templates: 'react' (create-react-app), 'vite' (create-vite), 'next' (create-next-app), 'express' (express-generator), or 'node' (npm init -y).",
    schema: {
      template: "string", // e.g. 'react', 'vite', 'next', 'express', 'node'
      path: "string" // relative path where to create the project
    },
    risk: "medium"
  },
  "npm_manager": {
    description: "Manage NPM dependencies. Automatically runs `npm install` inside the target directory.",
    schema: {
      path: "string", // relative path to the directory containing package.json
      packages: "array?" // Optional array of packages to install (e.g. ['express', 'cors']). If empty, runs `npm install`.
    },
    risk: "medium"
  },
  "fs.writeFile": {
    description: "Write content to a new file. Parent directories are automatically created if they don't exist. Do not use terminal commands like mkdir.",
    schema: {
      path: "string",
      content: "string",
    },
    risk: "low",
  },

  "fs.editFileLines": {
    description: "Edit an existing file by replacing a specific range of lines. Line numbers are 1-indexed. newCode will replace all lines from startLine to endLine inclusive.",
    schema: {
      path: "string",
      startLine: "number",
      endLine: "number",
      newCode: "string"
    },
    risk: "low"
  },
  "fs.deleteFile": {
    description: "Delete an existing file or directory.",
    schema: {
      path: "string",
    },
    risk: "high",
  },
  "fs.renameFile": {
    description: "Rename or move a file or directory. path is the current relative path, newPath is the new relative path.",
    schema: {
      path: "string",
      newPath: "string",
    },
    risk: "medium",
  },
  "fs.readFile": {
    description: "Read the contents of a file.",
    schema: {
      path: "string",
    },
    risk: "low",
  },
  "list_dir": {
    description: "List contents of a directory.",
    schema: {
      path: "string",
    },
    risk: "low",
  },
  "grep_search": {
    description: "Search for a string across files in a directory.",
    schema: {
      query: "string",
      directory: "string",
    },
    risk: "low",
  },
  "response": {
    description: "Respond to the user or finalize a task.",
    schema: {
      content: "string",
    },
    risk: "low",
  },
};

module.exports = { TOOL_REGISTRY };
