// src/agent-core/runtime/ParallelScheduler.js
/**
 * Parallel Scheduler
 * Executes compiled graph nodes sequentially or concurrently in parallel groups.
 */

class ParallelScheduler {
  async execute(graph, toolExecutor) {
    const results = [];
    const nodesMap = new Map(graph.nodes.map(n => [n.id, n]));

    for (const group of graph.concurrencyGroups) {
      if (group.type === "parallel") {
        // Concurrently run all nodes in the parallel group
        const groupPromises = group.nodeIds.map(async (nodeId) => {
          const node = nodesMap.get(nodeId);
          node.status = "running";
          try {
            const res = await toolExecutor(node);
            const isActualSuccess = res && res.success !== false;
            node.status = isActualSuccess ? "succeeded" : "failed";
            return { id: nodeId, success: isActualSuccess, result: res, error: res && (res.stderr || res.error) };
          } catch (err) {
            node.status = "failed";
            return { id: nodeId, success: false, error: err.message };
          }
        });
        
        const groupResults = await Promise.all(groupPromises);
        results.push(...groupResults);
        
        // If any parallel task failed, short circuit if needed
        const hasFailure = groupResults.some(r => !r.success);
        if (hasFailure) {
          throw new Error("Execution Graph failed due to parallel worker failure.");
        }
      } else {
        // Sequentially execute
        const nodeId = group.nodeIds[0];
        const node = nodesMap.get(nodeId);
        node.status = "running";
        try {
          const res = await toolExecutor(node);
          const isActualSuccess = res && res.success !== false;
          node.status = isActualSuccess ? "succeeded" : "failed";
          if (!isActualSuccess) {
            const err = new Error(res.stderr || res.error || "Tool execution failed.");
            Object.assign(err, { result: res });
            throw err;
          }
          results.push({ id: nodeId, success: true, result: res });
        } catch (err) {
          node.status = "failed";
          throw err;
        }
      }
    }
    return results;
  }
}

const schedulerInstance = new ParallelScheduler();
module.exports = { ParallelScheduler: schedulerInstance };
