/**
 * Intent Taxonomy & Seeding Data
 */

const TAXONOMY = {
  AGENT_TASK: {
    mode: 'agent', complexity: 70, scale: 'small', planning: true, tools: true, rag: true, terminal: true
  },
  ATOMIC_EDIT: {
    mode: 'fast_path', complexity: 20, scale: 'micro', planning: false, tools: true, rag: false, terminal: false
  },
  QA_CODE: {
    mode: 'chat', complexity: 40, scale: 'small', planning: false, tools: true, rag: true, terminal: false
  },
  QA_GENERAL: {
    mode: 'chat', complexity: 10, scale: 'micro', planning: false, tools: false, rag: false, terminal: false
  },
  WEB_SEARCH: {
    mode: 'chat', complexity: 30, scale: 'small', planning: false, tools: true, rag: false, terminal: false, web: true
  },
  MEMORY_WRITE: {
    mode: 'memory', complexity: 10, scale: 'micro', planning: false, tools: false, rag: false, terminal: false
  },
  MEMORY_READ: {
    mode: 'memory', complexity: 10, scale: 'micro', planning: false, tools: false, rag: false, terminal: false
  },
  MEMORY_DELETE: {
    mode: 'memory', complexity: 10, scale: 'micro', planning: false, tools: false, rag: false, terminal: false
  },
  WORKSPACE_OP: {
    mode: 'fast_path', complexity: 30, scale: 'micro', planning: false, tools: true, rag: false, terminal: true
  },
  GOAL_MANAGEMENT: {
    mode: 'system', complexity: 10, scale: 'micro', planning: false, tools: false, rag: false, terminal: false
  },
  MULTI_INTENT: {
    mode: 'agent', complexity: 90, scale: 'large', planning: true, tools: true, rag: true, terminal: true
  }
};

const SEED_EXAMPLES = [
  // AGENT_TASK
  { text: "Build a new React component for the login page", intent: "AGENT_TASK" },
  { text: "Refactor the database schema and add migrations", intent: "AGENT_TASK" },
  { text: "Create a python script to scrape this website", intent: "AGENT_TASK" },
  { text: "Implement authentication using JWT", intent: "AGENT_TASK" },
  
  // ATOMIC_EDIT
  { text: "Fix the typo in index.html", intent: "ATOMIC_EDIT" },
  { text: "Change the button color to red in app.css", intent: "ATOMIC_EDIT" },
  { text: "Add a console log here", intent: "ATOMIC_EDIT" },
  
  // QA_CODE
  { text: "Explain how this function works", intent: "QA_CODE" },
  { text: "Why is this code throwing a null pointer exception?", intent: "QA_CODE" },
  { text: "Review my database schema", intent: "QA_CODE" },
  
  // QA_GENERAL
  { text: "Hello", intent: "QA_GENERAL" },
  { text: "Good morning", intent: "QA_GENERAL" },
  { text: "What can you do?", intent: "QA_GENERAL" },
  { text: "Tell me a joke", intent: "QA_GENERAL" },
  
  // WEB_SEARCH
  { text: "Search for the latest Apple stock price", intent: "WEB_SEARCH" },
  { text: "What is the weather in London?", intent: "WEB_SEARCH" },
  { text: "Find recent news about AI", intent: "WEB_SEARCH" },
  { text: "Search the web for python 3.12 release notes", intent: "WEB_SEARCH" },
  
  // MEMORY
  { text: "Remember my name is John", intent: "MEMORY_WRITE" },
  { text: "Save this preference", intent: "MEMORY_WRITE" },
  { text: "My new laptop has 64GB RAM", intent: "MEMORY_WRITE" },
  { text: "my name is rahul and i am software developer in mern stack", intent: "MEMORY_WRITE" },
  { text: "i am a react developer", intent: "MEMORY_WRITE" },
  { text: "remember that my name is rahul", intent: "MEMORY_WRITE" },
  { text: "What do you know about me?", intent: "MEMORY_READ" },
  { text: "Recall my last project", intent: "MEMORY_READ" },
  { text: "What is my name?", intent: "MEMORY_READ" },
  { text: "Forget my address", intent: "MEMORY_DELETE" },
  { text: "Delete my preferences", intent: "MEMORY_DELETE" },
  
  // WORKSPACE_OP
  { text: "Run npm install", intent: "WORKSPACE_OP" },
  { text: "Start the dev server", intent: "WORKSPACE_OP" },
  { text: "Run the test suite", intent: "WORKSPACE_OP" },
  
  // MULTI_INTENT
  { text: "Search for apple stock and save the results to a file", intent: "MULTI_INTENT" },
  { text: "Explain React and then generate a starter project", intent: "MULTI_INTENT" }
];

function getDefaultIntent(intentName) {
  const t = TAXONOMY[intentName] || TAXONOMY.AGENT_TASK;
  return {
    intent: intentName,
    execution_mode: t.mode,
    complexity: t.complexity,
    task_scale: t.scale,
    risk_level: 'low',
    needs_rag: t.rag,
    needs_terminal: t.terminal,
    context_expansion_needed: false,
    requires_context: true,
    requires_planning: t.planning,
    requires_tools: t.tools,
    requires_memory: true,
    requires_web: t.web || false,
    requires_reflection: t.planning,
    estimated_files: t.scale === 'micro' ? 0 : (t.scale === 'small' ? 2 : 5)
  };
}

module.exports = {
  TAXONOMY,
  SEED_EXAMPLES,
  getDefaultIntent
};
