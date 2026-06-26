'use strict';

/**
 * @typedef {Object} SkillMetadata
 * @property {number} usageCount
 * @property {number} successCount
 * @property {number} avgExecutionTime
 * @property {number} lastUsed
 */

/**
 * @typedef {Object} Skill
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string[]} triggers
 * @property {string} category
 * @property {string[]} tools
 * @property {SkillMetadata} [_metadata]
 * @property {Function} execute
 * @property {Function} [validate]
 */

class SkillRegistry {
  constructor() {
    /** @type {Map<string, Skill>} */
    this.skills = new Map();
  }

  /**
   * Registers a skill in the registry
   * @param {Skill} skill 
   */
  register(skill) {
    if (!skill._metadata) {
      skill._metadata = {
        usageCount: 0,
        successCount: 0,
        avgExecutionTime: 0,
        lastUsed: 0
      };
    }
    this.skills.set(skill.id, skill);
    console.log(`[SkillRegistry] Registered skill: ${skill.id}`);
  }

  /**
   * Records execution metrics for a skill
   * @param {string} skillId 
   * @param {boolean} success 
   * @param {number} executionTimeMs 
   */
  recordExecution(skillId, success, executionTimeMs) {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    const m = skill._metadata;
    m.usageCount += 1;
    if (success) m.successCount += 1;
    m.avgExecutionTime = ((m.avgExecutionTime * (m.usageCount - 1)) + executionTimeMs) / m.usageCount;
    m.lastUsed = Date.now();
  }

  /**
   * Retrieves all registered skills
   * @returns {Skill[]}
   */
  getAllSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * Retrieves a specific skill by ID
   * @param {string} id 
   * @returns {Skill | undefined}
   */
  getSkill(id) {
    return this.skills.get(id);
  }
}

const skillRegistry = new SkillRegistry();
module.exports = { skillRegistry, SkillRegistry };
