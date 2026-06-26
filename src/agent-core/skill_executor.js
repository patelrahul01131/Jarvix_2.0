'use strict';

const { skillRegistry } = require('./skills/skill_registry');

class SkillExecutor {
  /**
   * Executes the sequence of planned skills.
   * @param {import('./types').ExecutionState} executionState 
   * @param {string[]} plan 
   * @param {object} args 
   * @returns {Promise<any[]>}
   */
  async executePlan(executionState, plan, args) {
    console.log(`[SkillExecutor] Executing plan with ${plan.length} steps.`);
    const results = [];

    for (const step of plan) {
      const skillId = typeof step === 'string' ? step : step.skill;
      const inputArgs = typeof step === 'string' ? {} : step.input;
      
      const skill = skillRegistry.getSkill(skillId) || skillRegistry.getAllSkills().find(s => s.name === skillId);
      if (!skill) {
        console.warn(`[SkillExecutor] Skill ${skillId} not found in registry.`);
        continue;
      }

      const startTime = Date.now();
      if (args.onStatus) args.onStatus(`[SkillExecutor] Running ${skill.name}...`);
      
      try {
        const result = await skill.execute(executionState, inputArgs);
        const executionTime = Date.now() - startTime;
        
        // Record telemetry for future learning
        skillRegistry.recordExecution(skillId, result.success, executionTime);
        
        results.push({ skill: skill.name, success: result.success, message: result.message, time: executionTime });
        
        if (!result.success) {
          console.warn(`[SkillExecutor] ${skill.name} failed. Halting plan.`);
          break; // Stop on failure in Phase 4 (Reflection layer handles recovery in Phase 5)
        }
      } catch (err) {
        console.error(`[SkillExecutor] ${skill.name} threw an error:`, err);
        skillRegistry.recordExecution(skillId, false, Date.now() - startTime);
        results.push({ skill: skill.name, success: false, message: err.message, time: Date.now() - startTime });
        break;
      }
    }

    return results;
  }
}

const skillExecutor = new SkillExecutor();
module.exports = { skillExecutor, SkillExecutor };
