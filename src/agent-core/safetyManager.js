/**
 * Safety Manager
 * 
 * Handles intelligent limit allocation, temporal protection (timeouts), and 
 * historical adaptation based on user/session data.
 */

const { getLongTermMemory, updateLongTermMemory } = require("../memory/shortTerm");

// Base timeout for one recursion step (milliseconds)
// Usually, an LLM call + tool execution takes around 3-8 seconds.
const STEP_BASE_TIMEOUT_MS = 6000; 

// The maximum absolute limit even for enterprise/power users to protect infra
const HARD_SYSTEM_MAX_LIMIT = 500;

class SafetyManager {
    /**
     * Allocate recursion limits and timeouts based on pre-flight analysis
     * @param {string} sessionId
     * @param {object} preFlightProfile - from preFlightAnalyzer.js
     * @returns {object} { limit, timeoutMs, reason }
     */
    static allocateLimits(sessionId, preFlightProfile) {
        // 1. Get user profile and historical data
        const profile = getLongTermMemory();
        if (!profile.safetyMetrics) {
            profile.safetyMetrics = {};
        }

        let allocatedLimit = preFlightProfile.baseLimit;
        let timeoutMs = preFlightProfile.baseLimit * STEP_BASE_TIMEOUT_MS * preFlightProfile.timeoutMultiplier;

        // 2. Adjust based on User Tier (if defined)
        const userTier = profile.tier || "free";
        const tierCaps = {
            "free": 100,
            "pro": 250,
            "enterprise": 400
        };
        const maxForTier = tierCaps[userTier] || 100;

        // 3. Adaptive Tuning based on historical metric of this intent
        const intentMetric = profile.safetyMetrics[preFlightProfile.intent];
        let adaptationReason = "";
        if (intentMetric && intentMetric.avgSteps) {
            // If the user typically only uses 40 steps for RESEARCH, lower the ceiling slightly
            // If they frequently hit limits, raise it slightly within bounds
            if (intentMetric.avgSteps < allocatedLimit * 0.5) {
                allocatedLimit = Math.floor(allocatedLimit * 0.8);
                adaptationReason = " (Optimized based on your historical efficiency)";
            } else if (intentMetric.timeoutFrequency > 0.1) {
                // If they timeout > 10% of the time, give more time buffer
                timeoutMs *= 1.3;
                adaptationReason = " (Extended timeout based on recent complex queries)";
            }
        }

        // 4. Apply Tier Ceilings and Hard Caps
        if (allocatedLimit > maxForTier) {
            allocatedLimit = maxForTier;
            adaptationReason = ` (Capped by ${userTier} tier limit)`;
        }
        if (allocatedLimit > HARD_SYSTEM_MAX_LIMIT) {
            allocatedLimit = HARD_SYSTEM_MAX_LIMIT;
        }

        // Ensure minimums
        if (allocatedLimit < 10) allocatedLimit = 10;
        if (timeoutMs < 30000) timeoutMs = 30000; // Absolute minimum 30 seconds

        return {
            recursionLimit: allocatedLimit,
            timeoutMs: timeoutMs,
            reason: `Allocated ${allocatedLimit} steps for ${preFlightProfile.intent}${adaptationReason}`
        };
    }

    /**
     * Track actual performance and update the profile
     * @param {string} intent 
     * @param {number} actualSteps 
     * @param {boolean} timedOut 
     * @param {boolean} limitExceeded 
     */
    static recordExecutionMetrics(intent, actualSteps, timedOut, limitExceeded) {
        const profile = getLongTermMemory();
        if (!profile.safetyMetrics) profile.safetyMetrics = {};
        if (!profile.safetyMetrics[intent]) {
            profile.safetyMetrics[intent] = { totalRuns: 0, avgSteps: 0, timeoutFrequency: 0, limitHitFrequency: 0 };
        }

        const m = profile.safetyMetrics[intent];
        
        // Rolling average for steps
        m.avgSteps = ((m.avgSteps * m.totalRuns) + actualSteps) / (m.totalRuns + 1);
        
        // Frequencies
        const newTotal = m.totalRuns + 1;
        m.timeoutFrequency = ((m.timeoutFrequency * m.totalRuns) + (timedOut ? 1 : 0)) / newTotal;
        m.limitHitFrequency = ((m.limitHitFrequency * m.totalRuns) + (limitExceeded ? 1 : 0)) / newTotal;
        m.totalRuns = newTotal;

        updateLongTermMemory(profile);
    }

    /**
     * Generate a graceful degradation message based on the error
     */
    static generateDegradationMessage(errorType, stepsTaken, limit, partialTasks) {
        let msg = "";
        if (errorType === "TIMEOUT") {
            msg += `⏳ **Processing Timeout**: The system took too long to complete this complex request.\n`;
        } else if (errorType === "RECURSION_LIMIT") {
            msg += `🛑 **Complexity Limit Reached**: I safely paused execution after reaching the maximum allocated steps (${limit}).\n`;
        } else {
            msg += `⚠️ **Execution Error**: An unexpected issue occurred.\n`;
        }

        msg += `\n**Diagnostic Info:** Took ${stepsTaken} steps.\n`;

        if (partialTasks && partialTasks.length > 0) {
            msg += `\n✅ **Partial Progress Saved:**\n`;
            for (const t of partialTasks) {
                msg += `- ${t}\n`;
            }
        }

        msg += `\n💡 **Suggested Next Steps:**\n`;
        msg += `- Break your request into smaller, focused chunks.\n`;
        msg += `- Ask me to summarize the current partial results.\n`;

        return msg;
    }
}

module.exports = SafetyManager;
