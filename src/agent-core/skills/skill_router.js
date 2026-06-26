'use strict';

// Load registry and implementations
const { skillRegistry } = require('./skill_registry');
require('./implementations/RenameSymbol');
require('./implementations/SearchWorkspace');
require('./implementations/AnalyzeCodebase');
require('./implementations/FixBuildErrors');

class SkillRouter {
  /**
   * Semantically matches and returns a subset of relevant skills for the goal/intent.
   * @param {string} goal 
   * @param {string} intent 
   * @returns {import('./skill_registry').Skill[]}
   */
  route(goal, intent) {
    console.log(`[SkillRouter] Routing for intent: ${intent}`);
    const allSkills = skillRegistry.getAllSkills();
    const selected = [];

    const lowerGoal = goal.toLowerCase();
    const lowerIntent = intent.toLowerCase();

    // 1. Trigger matching
    for (const skill of allSkills) {
      const match = skill.triggers.some(t => lowerGoal.includes(t.toLowerCase()) || lowerIntent.includes(t.toLowerCase()));
      if (match) {
        selected.push(skill);
      }
    }

    // 2. Semantic Fallback
    if (selected.length === 0) {
      if (lowerIntent.includes('refactor') || lowerIntent.includes('rename')) {
        selected.push(skillRegistry.getSkill('skill_rename_symbol'));
      } else if (lowerIntent.includes('bug') || lowerIntent.includes('error')) {
        selected.push(skillRegistry.getSkill('skill_fix_build_errors'));
        selected.push(skillRegistry.getSkill('skill_analyze_codebase'));
      } else {
        selected.push(skillRegistry.getSkill('skill_search_workspace'));
      }
    }

    return selected.filter(Boolean);
  }

  /**
   * Retrieves a specific skill by ID or Name.
   * @param {string} skillIdentifier 
   * @returns {import('./skill_registry').Skill | undefined}
   */
  getSkill(skillIdentifier) {
    return skillRegistry.getSkill(skillIdentifier) || skillRegistry.getAllSkills().find(s => s.name === skillIdentifier);
  }
}

const skillRouter = new SkillRouter();
module.exports = { skillRouter, SkillRouter };
