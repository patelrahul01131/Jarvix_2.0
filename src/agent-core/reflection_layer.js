'use strict';

class ReflectionLayer {
  /**
   * Analyzes execution results to determine if the goal was met.
   * If not, suggests a recovery plan or records the failure.
   * @param {import('./types').ExecutionState} executionState 
   * @returns {{ passed: boolean, recoveryPlan?: string[], message: string }}
   */
  reflect(executionState) {
    console.log(`[ReflectionLayer] Analyzing execution results...`);
    const results = executionState.executionResults || [];
    
    const failedSteps = results.filter(r => !r.success);

    if (failedSteps.length === 0) {
      return { 
        passed: true, 
        message: 'All skills executed successfully. Goal achieved.' 
      };
    }

    // Determine recovery heuristic based on what failed
    const recoveryPlan = [];
    const messages = [];

    for (const failure of failedSteps) {
      messages.push(`Skill ${failure.skill} failed: ${failure.message}`);
      
      // Simple heuristic recovery mapping
      if (failure.skill === 'RenameSymbol') {
        recoveryPlan.push('skill_search_workspace'); // Re-evaluate workspace
      } else if (failure.skill === 'FixBuildErrors') {
        recoveryPlan.push('skill_analyze_codebase'); // Deep dive into the failure
      }
    }

    // Deduplicate
    const uniqueRecovery = [...new Set(recoveryPlan)];

    return {
      passed: false,
      recoveryPlan: uniqueRecovery.length > 0 ? uniqueRecovery : null,
      message: `Execution failed. ${messages.join(' | ')}`
    };
  }
}

const reflectionLayer = new ReflectionLayer();
module.exports = { reflectionLayer, ReflectionLayer };
