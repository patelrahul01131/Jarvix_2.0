'use strict';

/**
 * Goal Extractor — src/agent-core/goal_extractor.js
 *
 * Extracted from loop.js `normalizeGoal()`.
 * Normalizes the user's raw input into a structured goal with extracted facts,
 * memory operations (renames, deletes), and session-scoped instructions.
 *
 * RESPONSIBILITIES:
 *   - Extract and normalize the user's goal statement
 *   - Extract permanent facts (user prefs, projects, relationships)
 *   - Detect topic shifts (resetMemory)
 *   - Extract rename/delete memory operations
 *
 * DOES NOT:
 *   - Execute memory writes (caller is responsible)
 *   - Call the planner
 *   - Modify session state directly
 */

const { callLLM }    = require('./llmClient');
const { extractJson } = require('../core/utils');

// ─── System Prompt ────────────────────────────────────────────────────────────

function _buildSystem(previousGoal, recentCtx, currentProfile) {
  const now = new Date().toISOString();
  return `You are the Goal and Fact Extractor.
Extract the user's implicit or explicit goal into a concise, actionable statement.
Compare this to the previous goal: "${previousGoal || 'None'}".
If the topic has shifted drastically, set resetMemory to true.

CRITICAL FACT EXTRACTION:
Extract facts EXPLICITLY STATED by the user. DO NOT infer facts from workspace or filesystem operations.
Categorize permanent facts into:
- user: (e.g., {"laptop_ram": {"value": "32GB", "source": "user_statement", "updated_at": "${now}"}})
- projects: (Use stable IDs. e.g. {"project_1": {"name": "IntelliPilot", "language": "TypeScript", "source": "user_statement", "updated_at": "${now}"}})
- preferences: (e.g., {"answer_style": {"value": "short", "source": "user_statement", "updated_at": "${now}"}})
- relationships: (e.g., {"friend": {"name": "Amit", "source": "user_statement", "updated_at": "${now}"}})

RENAME LOGIC:
If the user asks to rename an entity (project, preference, etc.), check the Current User Profile to find the entity by its CURRENT name (resolving pronouns like "it" from recent conversation context).
Then output a rename operation in the "renames" array:
{
  "category": "projects",
  "entity_id": "project_1",
  "field": "name",
  "old_value": "IntelliPilot",
  "new_value": "IntelliCore",
  "updated_at": "${now}"
}
Do NOT add the renamed entity to the permanent.projects block — use the renames array only.

TEMPORARY INSTRUCTIONS:
If the user gives a temporary instruction (e.g. "for this response only"), add it to session_instructions array. NEVER store it in permanent.

FORGET LOGIC:
If the user asks to forget something, add its exact dot-notation key (e.g. "permanent.projects.project_1") to remove_keys array.

Recent Conversation (for resolving pronouns like "it", "that project"):
${recentCtx || 'None'}

Current User Profile:
${JSON.stringify(currentProfile, null, 2)}

Output strictly as JSON:
{
  "goal": "string",
  "resetMemory": boolean,
  "extractedFacts": {
    "permanent": {
      "user": {},
      "projects": {},
      "preferences": {},
      "relationships": {}
    },
    "renames": [
      {
        "category": "string",
        "entity_id": "string",
        "field": "string",
        "old_value": "string",
        "new_value": "string",
        "updated_at": "string"
      }
    ],
    "session_instructions": ["string"],
    "remove_keys": ["string"]
  }
}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize the user's raw question into a structured goal + extracted facts.
 *
 * @param {string}   question        - Raw user input
 * @param {object}   intent          - Result from classifyIntent()
 * @param {string}   previousGoal    - Last known goal (for drift detection)
 * @param {object}   args            - Runtime args: { model, provider }
 * @param {object}   currentProfile  - Current user long-term profile object
 * @param {Array}    recentMessages  - Recent session messages for pronoun resolution
 * @returns {Promise<GoalExtractionResult>}
 */
async function normalizeGoal(question, intent, previousGoal, args, currentProfile, recentMessages) {
  const recentCtx = (recentMessages || [])
    .slice(-6)
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n');

  const system = _buildSystem(previousGoal, recentCtx, currentProfile);

  try {
    let rawOutput = '';
    await callLLM({
      messages: [
        {
          role:    'user',
          content: `Analyze the following user input and extract the goal and facts as instructed.\n\n<user_input>\n${question}\n</user_input>\n\nRemember: You must output ONLY valid JSON, do not reply conversationally. Escape all newlines in strings as \\n.`,
        },
      ],
      system,
      model:    args.model,
      provider: args.provider,
      signal:   args.signal,
      onChunk:  (c) => { rawOutput += c; },
    });

    const result = extractJson(rawOutput);
    if (!result) {
      console.warn('[GoalExtractor] extractJson returned null. Raw Output was:', rawOutput);
      throw new Error('No valid JSON in goal extraction response');
    }
    return result;
  } catch (err) {
    console.warn('[GoalExtractor] Failed to extract goal, using raw question.', err.message);
    return { goal: question, resetMemory: false, extractedFacts: null };
  }
}

/**
 * Phase 1 Architecture: Extracts goal and intent specifically for the new Supervisor flow.
 * Outputs a strict ExecutionState-compatible goal object.
 *
 * @param {string} question 
 * @param {object} args 
 * @returns {Promise<{goal: string, taskType: string, entities: any[], constraints: string[]}>}
 */
async function extractExecutionGoal(question, args) {
  const system = `You are the Supervisor Goal Extractor.
Extract the user's intent into the following strict JSON schema:
{
  "goal": "Clear, actionable restatement of the goal",
  "taskType": "e.g., rename, create_component, refactor, chat, fix_bug",
  "entities": [ {"type": "file|symbol|concept", "name": "...", "action": "..."} ],
  "constraints": [ "e.g., Do not use Tailwind", "Must run tests" ]
}
Respond ONLY with valid JSON. Do not include markdown formatting or extra text.`;

  try {
    let rawOutput = '';
    await callLLM({
      messages: [{ role: 'user', content: question }],
      system,
      model: args.model,
      provider: args.provider,
      signal: args.signal,
      onChunk: (c) => { rawOutput += c; },
    });

    const result = extractJson(rawOutput);
    if (!result || !result.goal) throw new Error('No valid JSON extracted');
    
    return {
      goal: result.goal || question,
      taskType: result.taskType || "unknown",
      entities: result.entities || [],
      constraints: result.constraints || []
    };
  } catch (err) {
    console.warn('[SupervisorGoalExtractor] Fallback triggered.', err.message);
    return { goal: question, taskType: "unknown", entities: [], constraints: [] };
  }
}

module.exports = { normalizeGoal, extractExecutionGoal };
