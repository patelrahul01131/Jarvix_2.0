'use strict';

class ContextBudgetManager {
  /**
   * @param {number} maxTokens Optional maximum tokens (or chars approximation) for context budget. Default 20,000.
   */
  constructor(maxTokens = 20000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Extremely simple approximation: 1 token ~= 4 characters.
   * @param {any} obj 
   * @returns {number}
   */
  _estimateTokens(obj) {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return Math.ceil((str ? str.length : 0) / 4);
  }

  /**
   * Trims the retrieved context to fit within the budget.
   * Prioritizes Working Memory > High Scored Context.
   * @param {import('./types').ContextItem[]} contextFeed 
   * @returns {import('./types').ContextItem[]}
   */
  enforceBudget(contextFeed) {
    let currentTokens = 0;
    const finalFeed = [];

    // Separate mandatory vs optional
    const workingMemory = contextFeed.find(c => c.source === 'working_memory');
    const others = contextFeed.filter(c => c.source !== 'working_memory');

    // 1. Always include working memory
    if (workingMemory) {
      const tokens = this._estimateTokens(workingMemory.content);
      currentTokens += tokens;
      finalFeed.push(workingMemory);
    }

    // 2. Include others strictly ordered by score until budget hit
    for (const item of others) {
      const tokens = this._estimateTokens(item.content);
      if (currentTokens + tokens <= this.maxTokens) {
        currentTokens += tokens;
        finalFeed.push(item);
      } else {
        // If one item breaches budget, we could optionally truncate it, 
        // but for now we'll just skip it and see if smaller items fit.
        console.warn(`[ContextBudgetManager] Item from ${item.source} breached budget. Skipping.`);
      }
    }

    return finalFeed;
  }
}

const contextBudgetManager = new ContextBudgetManager();
module.exports = { contextBudgetManager, ContextBudgetManager };
