class ContextIntentResolver {
  /**
   * Resolves conversational traps like pronouns or "same as before"
   * @param {string} text - User's current message
   * @param {object} session - Session object containing history
   */
  resolve(text, session) {
    const textLower = text.toLowerCase().trim();
    
    // Check for pronoun traps / continuation
    const isContinuation = /^(update|fix|change|make|now|same|do it|run it)\b/i.test(textLower) || 
                           /(it|that|this|there|before)$/i.test(textLower);

    if (isContinuation && session && session.messages) {
      // Find the last agent action intent or user intent
      // For now, if it's a continuation, we heavily bias towards AGENT_TASK or ATOMIC_EDIT
      // because they are modifying something just discussed.
      
      // Look back in history to see what was discussed
      const recent = session.messages.slice(-3);
      const codeContext = recent.some(m => typeof m.content === 'string' && (m.content.includes('```') || m.content.includes('.js') || m.content.includes('file')));
      
      if (codeContext) {
        return {
          resolvedText: `Modify the recent code: ${text}`,
          inferredContext: 'CODE_MODIFICATION'
        };
      }
    }

    return { resolvedText: text, inferredContext: null };
  }
}

module.exports = { ContextIntentResolver };
