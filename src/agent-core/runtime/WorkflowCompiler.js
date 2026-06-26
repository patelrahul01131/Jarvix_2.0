// src/agent-core/runtime/WorkflowCompiler.js
/**
 * Workflow Compiler
 * Compiles parsed DSL steps into a dependency-aware graph of execution blocks.
 */

class WorkflowCompiler {
  compile(parsedDsl) {
    const graph = {
      nodes: [],
      concurrencyGroups: []
    };

    const steps = parsedDsl.steps || [];
    let nodeIdCounter = 1;

    for (const step of steps) {
      if (step.type === "parallel") {
        const groupNodes = step.actions.map(act => ({
          id: nodeIdCounter++,
          capability: act.capability,
          target: act.target,
          status: "pending",
          retryLimit: 1
        }));
        
        graph.nodes.push(...groupNodes);
        graph.concurrencyGroups.push({
          type: "parallel",
          nodeIds: groupNodes.map(n => n.id)
        });
      } else {
        const node = {
          id: nodeIdCounter++,
          capability: step.action.capability,
          target: step.action.target,
          status: "pending",
          retryLimit: 1
        };
        
        graph.nodes.push(node);
        graph.concurrencyGroups.push({
          type: "sequential",
          nodeIds: [node.id]
        });
      }
    }

    return graph;
  }
}

const compilerInstance = new WorkflowCompiler();
module.exports = { WorkflowCompiler: compilerInstance };
