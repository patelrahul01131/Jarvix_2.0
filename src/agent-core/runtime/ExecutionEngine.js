// src/agent-core/runtime/ExecutionEngine.js
/**
 * Execution Engine Facade
 * Decouples and coordinates: DslParser -> WorkflowCompiler -> TieredValidator -> ParallelScheduler.
 */

const { parseDSL } = require("./DslParser");
const { WorkflowCompiler } = require("./WorkflowCompiler");
const { TieredValidator } = require("./TieredValidator");
const { ParallelScheduler } = require("./ParallelScheduler");

class ExecutionEngine {
  async executePlan(dslText, toolExecutor, capabilityRegistry) {
    // 1. Tiered Validation & Local Repair of plan raw text
    const repairResult = TieredValidator.validateAndRepair(dslText);
    if (!repairResult.success) {
      throw new Error(`Plan Validation Failure: ${repairResult.error}`);
    }

    // 2. Parse DSL to structure
    const parsedDsl = parseDSL(repairResult.planText);

    // 3. Compile DSL structure to DAG Graph
    const graph = WorkflowCompiler.compile(parsedDsl);

    // 4. Validate capabilities in registry
    for (const node of graph.nodes) {
      const valResult = TieredValidator.validateCapability(node, capabilityRegistry);
      if (!valResult.success) {
        throw new Error(`Execution Validation Error: ${valResult.error}`);
      }
    }

    // 5. Schedule & execute DAG parallel/sequential groups
    return await ParallelScheduler.execute(graph, toolExecutor);
  }
}

const executionEngineInstance = new ExecutionEngine();
module.exports = { ExecutionEngine: executionEngineInstance };
