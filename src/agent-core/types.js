/**
 * @typedef {Object} Skill
 * @property {string} id
 * @property {string} name
 * @property {string} description
 */

/**
 * @typedef {Object} ContextItem
 * @property {"working_memory" | "semantic_memory" | "episodic_memory" | "workspace_graph" | "lancedb" | "execution_state" | "world_model" | "observations_and_beliefs"} source
 * @property {number} score
 * @property {any} content
 */

/**
 * @typedef {Object} ExecutionState
 * @property {string} goal
 * @property {string} intent
 * @property {any} workingMemory
 * @property {Skill[]} selectedSkills
 * @property {ContextItem[]} retrievedContext
 * @property {any} plan
 * @property {any} executionResults
 * @property {any} verificationResults
 * @property {any} telemetry
 */

module.exports = {};
