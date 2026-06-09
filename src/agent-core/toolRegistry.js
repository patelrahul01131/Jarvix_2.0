// src/agent-core/toolRegistry.js
/**
 * Single Source of Truth Tool Registry
 * Defines exact capabilities, schemas, and runtime execution constraints.
 */

const TOOL_REGISTRY = {
  "terminal.exec": {
    description: "Run safe CLI commands. You must provide the base command and an array of arguments.",
    schema: {
      cmd: "string", // Must be one of allowedCommands
      args: "array", // Array of string arguments
    },
    allowedCommands: ["npm", "node", "git", "npx"],
    risk: "medium",
  },
  "fs.writeFile": {
    description: "Write content to a file. Overwrites if exists.",
    schema: {
      path: "string",
      content: "string",
    },
    risk: "low",
  },
  "fs.editFile": {
    description: "Edit an existing file.",
    schema: {
      path: "string",
      instruction: "string",
      oldContent: "string",
      newContent: "string",
    },
    risk: "low",
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
