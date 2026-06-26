'use strict';

class ExecutionPlanner {
  /**
   * Plans the execution sequence of the selected skills.
   * @param {import('./types').ExecutionState} executionState 
   * @param {import('./skills/skill_registry').Skill[]} selectedSkills 
   * @returns {string[]} Ordered list of skill IDs
   */
  plan(executionState, selectedSkills) {
    console.log(`[ExecutionPlanner] Planning sequence for ${selectedSkills.length} skills.`);
    
    // In a full implementation, an LLM call would sequence the skills based on context.
    // For Phase 4, we use a heuristic sequence.
    const plan = [];

    // Analysis always first
    const analysisSkill = selectedSkills.find(s => s.category === 'analysis');
    if (analysisSkill) plan.push(analysisSkill.id);

    // Discovery next
    const discoverySkill = selectedSkills.find(s => s.category === 'discovery');
    if (discoverySkill) plan.push(discoverySkill.id);

    // Refactoring/Modification
    const refactorSkill = selectedSkills.find(s => s.category === 'refactoring');
    if (refactorSkill) plan.push(refactorSkill.id);

    // Debugging last
    const debugSkill = selectedSkills.find(s => s.category === 'debugging');
    if (debugSkill) plan.push(debugSkill.id);

    // Add any remaining
    selectedSkills.forEach(s => {
      if (!plan.includes(s.id)) plan.push(s.id);
    });

    return plan;
  }
}

const executionPlanner = new ExecutionPlanner();
module.exports = { executionPlanner, ExecutionPlanner };
