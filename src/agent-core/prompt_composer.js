'use strict';

class PromptComposer {
  /**
   * Composes the final LLM prompt based on the budgeted ContextPackage/ExecutionState.
   * @param {import('./types').ExecutionState} executionState 
   * @param {import('./types').ContextItem[]} budgetedFeed 
   * @returns {string} The formatted system/user prompt
   */
  compose(executionState, budgetedFeed) {
    let prompt = `You are Jarvix, an advanced autonomous coding agent.\n\n`;
    
    prompt += `### Current Goal\n${executionState.goal}\n\n`;
    prompt += `### Task Intent\n${executionState.intent}\n\n`;
    
    if (executionState.selectedSkills && executionState.selectedSkills.length > 0) {
      prompt += `### Available Skills\n`;
      executionState.selectedSkills.forEach(skill => {
        prompt += `- **${skill.name}**: ${skill.description}\n`;
      });
      prompt += `\n`;
    }

    prompt += `### Context Feed\n`;
    budgetedFeed.forEach(item => {
      prompt += `--- Source: ${item.source} (Score: ${item.score}) ---\n`;
      prompt += typeof item.content === 'object' 
        ? JSON.stringify(item.content, null, 2) 
        : item.content;
      prompt += `\n\n`;
    });

    prompt += `### Instructions\n`;
    prompt += `Please output your execution plan or next action based strictly on the context provided above.\n`;
    
    return prompt;
  }
}

const promptComposer = new PromptComposer();
module.exports = { promptComposer, PromptComposer };
