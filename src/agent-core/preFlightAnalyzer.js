/**
 * Pre-Flight Analyzer
 * 
 * Performs lightweight, fast intent classification outside of the LangGraph execution.
 * Provides a heuristic baseline for recursion limits and timeouts.
 */

const KEYWORDS = {
    SIMPLE_QUERY: ["what is", "how do", "tell me", "explain", "who is"],
    ATOMIC_EDIT: ["fix typo", "change color", "rename", "add a console.log", "small fix"],
    RESEARCH: ["compare", "analyze all", "comprehensive", "research", "find all", "history of", "deep dive"],
    CODE_MOD: ["build", "create", "refactor", "add feature", "implement", "integrate"],
    DEBUG: ["bug", "error", "crashed", "failing", "not working", "why is"],
};

/**
 * Perform a quick text analysis to determine baseline complexity
 * @param {string} input - User query
 * @returns {object} Base safety profile
 */
function analyzeIntent(input) {
    if (!input || typeof input !== 'string') {
        return {
            intent: "UNKNOWN",
            baseLimit: 50,
            timeoutMultiplier: 1.0,
            complexity: 50,
            isComplex: true
        };
    }

    const lower = input.toLowerCase();
    let bestMatch = "UNKNOWN";
    let highestScore = 0;

    for (const [intent, words] of Object.entries(KEYWORDS)) {
        let score = 0;
        for (const word of words) {
            if (lower.includes(word)) score += 1;
        }
        if (score > highestScore) {
            highestScore = score;
            bestMatch = intent;
        }
    }

    // Default heuristics
    let baseLimit = 50;
    let timeoutMultiplier = 1.0;
    let complexity = 50;
    let isComplex = false;

    switch (bestMatch) {
        case "SIMPLE_QUERY":
        case "ATOMIC_EDIT":
            baseLimit = 30; // 10-15 steps is usually enough, adding buffer
            timeoutMultiplier = 0.5; // Short timeout (faster response expected)
            complexity = 20;
            break;
        case "DEBUG":
            baseLimit = 80;
            timeoutMultiplier = 1.5;
            complexity = 70;
            isComplex = true;
            break;
        case "RESEARCH":
        case "CODE_MOD":
            baseLimit = 150;
            timeoutMultiplier = 2.0; // Needs time for web searches or deep file traversals
            complexity = 90;
            isComplex = true;
            break;
        default:
            // Conservative fallback
            baseLimit = 60;
            timeoutMultiplier = 1.0;
            complexity = 50;
            isComplex = false;
            break;
    }

    // Heuristic Adjustments
    // Compound queries (e.g., using "and", "then")
    const compoundCount = (lower.match(/\b(and|then|after|also)\b/g) || []).length;
    if (compoundCount > 1) {
        baseLimit += (compoundCount * 10);
        complexity = Math.min(100, complexity + 10);
        isComplex = true;
    }

    // Temporal markers indicating breadth
    if (lower.match(/\b(over time|last decade|history|all versions)\b/)) {
        baseLimit += 50;
        timeoutMultiplier += 0.5;
        isComplex = true;
    }

    // Enforce hard ceiling to prevent massive over-allocation
    if (baseLimit > 300) baseLimit = 300;

    return {
        intent: bestMatch,
        baseLimit,
        timeoutMultiplier,
        complexity,
        isComplex,
        confidence: highestScore > 0 ? "HIGH" : "LOW"
    };
}

module.exports = {
    analyzeIntent
};
