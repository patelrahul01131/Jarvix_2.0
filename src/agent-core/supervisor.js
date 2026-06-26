'use strict';

const { telemetry } = require('../observability/telemetry');
const { sessionManager } = require('../memory/session_manager');
const { extractExecutionGoal } = require('./goal_extractor');
const { memoryFeedManager } = require('../memory/feed_manager');
const { contextBudgetManager } = require('./context_budget_manager');
const { promptComposer } = require('./prompt_composer');

/**
 * The Phase 2 Supervisor.
 * Orchestrates the execution flow using the unified ExecutionState.
 * Note: Skills, Reflection, Retrieval, and Knowledge Graph are stubbed until Phase 3+.
 */
class Supervisor {
  
  /**
   * Main entry point for the new architecture.
   * 
   * @param {string} sessionId 
   * @param {string} rawInput 
   * @param {object} args 
   * @returns {Promise<{success: boolean, status: string, message: string}>}
   */
  async execute(sessionId, rawInput, args) {
    const startTime = Date.now();
    let tokensSent = 0;
    let tokensReceived = 0;

    // 1. Initialize Session
    const session = sessionManager.getOrCreateSession(sessionId, rawInput);
    
    if (args.onStatus) {
      args.onStatus(`[Supervisor] Initializing Phase 2 flow for session ${sessionId}...`);
    }

    // 2. Build Execution State
    /** @type {import('./types').ExecutionState} */
    const executionState = {
      goal: rawInput,
      intent: null,
      workingMemory: { currentStep: 1, blockers: [] },
      selectedSkills: [],
      retrievedContext: [],
      plan: null,
      executionResults: null,
      verificationResults: null,
      telemetry: {}
    };

    try {
      // 3. Goal Extraction
      const extractStart = Date.now();
      if (args.onStatus) args.onStatus(`[Supervisor] Extracting Goal & Intent...`);
      
      const extracted = await extractExecutionGoal(rawInput, args);
      executionState.goal = extracted.goal;
      executionState.intent = extracted.taskType;
      executionState.workingMemory.entities = extracted.entities;
      executionState.workingMemory.constraints = extracted.constraints;
      
      sessionManager.updateGoal(sessionId, extracted.goal);
      const goalExtractionTime = Date.now() - extractStart;

      // Emit State: Phase 1
      if (args.onState) {
        args.onState({
          type: "AGENT_STATE",
          phase: "PLANNING",
          currentStep: "Goal and Intent extracted",
          goal: executionState.goal,
          intent: executionState.intent,
          entities: executionState.workingMemory.entities
        });
      }

      // 4. Phase 2: Context Assembly
      const retrievalStart = Date.now();
      if (args.onStatus) args.onStatus(`[Supervisor] Assembling Context Feed...`);
      
      // Get ranked context feed
      const rawFeed = await memoryFeedManager.getContextFeed(sessionId, executionState);
      
      // Enforce strict context budget
      const budgetedFeed = contextBudgetManager.enforceBudget(rawFeed);
      executionState.retrievedContext = budgetedFeed;
      
      // Compose prompt
      const finalPrompt = promptComposer.compose(executionState, budgetedFeed);
      tokensSent = contextBudgetManager._estimateTokens(finalPrompt); // Approximate

      const memoryRetrievalTime = Date.now() - retrievalStart;

      // Emit State: Phase 2/3
      if (args.onState) {
        args.onState({
          type: "AGENT_STATE",
          phase: "ASSEMBLING_CONTEXT",
          currentStep: "Context feed built and budgeted",
          contextTokens: tokensSent,
          retrievedContext: budgetedFeed.length
        });
      }

      // 5. Phase 4: Skill Execution Engine
      const planningStart = Date.now();
      if (args.onStatus) args.onStatus(`[Supervisor] Reasoning and Planning Skills...`);
      
      const { runThinker, runActor } = require('./planner');
      const { skillRouter } = require('./skills/skill_router');
      const { skillExecutor } = require('./skill_executor');

      // Think
      const thinkerResult = await runThinker(executionState, args);
      executionState.workingMemory.recentFindings = [thinkerResult.thought];
      
      // Act
      const actorResult = await runActor(executionState, args, thinkerResult.thought);
      
      // Parse LLM output into selected skills
      executionState.plan = actorResult.action; // Array of { skill: 'name', input: {...} }
      executionState.workingMemory.currentPlan = executionState.plan;
      executionState.selectedSkills = actorResult.action.map(a => skillRouter.getSkill(a.skill) || require('./skills/skill_registry').skillRegistry.getAllSkills().find(s => s.name === a.skill || s.id === a.skill)).filter(Boolean);
      
      const planningTime = Date.now() - planningStart;

      // Execute
      const executionStart = Date.now();
      sessionManager.addTask(sessionId, extracted.taskType);
      
      // Emit State: Phase 4
      if (args.onState) {
        args.onState({
          type: "AGENT_STATE",
          phase: "EXECUTING_SKILLS",
          currentStep: "Executing Planned Sequence",
          budget: { tokensUsed: tokensSent, maxTokens: 20000 },
          plan: executionState.plan,
          selectedSkills: executionState.selectedSkills.map(s => ({ id: s.id, name: s.name }))
        });
      }

      executionState.executionResults = await skillExecutor.executePlan(executionState, executionState.plan, args);
      executionState.workingMemory.activeTasks = executionState.executionResults.map(r => r.skill || "unknown_skill");
      
      sessionManager.completeTask(sessionId, extracted.taskType);
      const executionTime = Date.now() - executionStart;
      
      const taskSuccess = executionState.executionResults.every(r => r.success);

      // 6. Phase 5: Polish & Intelligence (Reflection & Memory Lifecycle)
      if (args.onStatus) args.onStatus(`[Supervisor] Reflecting on execution results...`);
      const { reflectionLayer } = require('./reflection_layer');
      const { memoryLifecycleManager } = require('../memory/lifecycle_manager');

      const reflection = reflectionLayer.reflect(executionState);
      executionState.verificationResults = reflection;
      executionState.workingMemory.recentFindings.push(reflection.message);

      // Emit State: Phase 5
      if (args.onState) {
        args.onState({
          type: "AGENT_STATE",
          phase: "REFLECTING",
          currentStep: "Analyzing execution outcome",
          budget: { tokensUsed: tokensSent, maxTokens: 20000 },
          reflection: { passed: reflection.passed, recoveryPlan: reflection.recoveryPlan, message: reflection.message }
        });
      }

      if (!reflection.passed && reflection.recoveryPlan) {
        if (args.onChunk) args.onChunk(`\n⚠️ **[Supervisor] Execution failed.** Recovery plan formulated: ${reflection.recoveryPlan.join(', ')}\n`);
        // In a real loop, we would restart the pipeline here with the new plan.
        // For Phase 5 demonstration, we just log it.
      }

      await memoryLifecycleManager.processSessionEnd(sessionId, executionState, reflection.passed);
      // ---------------------

      // Telemetry Logging
      const totalTime = Date.now() - startTime;
      telemetry.logTask(sessionId, {
        goal_extraction_time: goalExtractionTime,
        memory_retrieval_time: memoryRetrievalTime,
        planning_time: planningTime,
        execution_time: executionTime,
        prompt_tokens: tokensSent,
        completion_tokens: tokensReceived,
        retrieved_memories: executionState.retrievedContext.length,
        selected_skills: executionState.selectedSkills.length,
        task_success: reflection.passed
      });

      if (args.onChunk) {
        args.onChunk(`\n✅ **[Supervisor] Complete Agent Pipeline Executed Successfully**\n`);
        args.onChunk(`- **Goal**: ${extracted.goal}\n`);
        args.onChunk(`- **Skills Used**: ${executionState.selectedSkills.map(s => s.name).join(', ')}\n`);
        args.onChunk(`- **Success**: ${reflection.passed}\n`);
        args.onChunk(`- **Time**: ${totalTime}ms\n\n`);
      }

      return { success: reflection.passed, status: reflection.passed ? "DONE" : "FAILED", message: reflection.message };

    } catch (err) {
      console.error("[Supervisor] Execution Error:", err);
      telemetry.logTask(sessionId, { task_success: false });
      if (args.onChunk) {
        args.onChunk(`\n❌ **[Supervisor] Error:** ${err.message}\n`);
      }
      return { success: false, status: "FAILED", message: err.message };
    }
  }
}

const supervisor = new Supervisor();
module.exports = { supervisor, Supervisor };
