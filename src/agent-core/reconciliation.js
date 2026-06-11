const { eventBus, EVENTS } = require("../core/event_bus");

/**
 * ReconciliationNode
 * Resolves paradoxes between the deterministic Workspace Graph (world_state)
 * and the agent's Inferred Memory (beliefs), ensuring Jarvix doesn't fight reality.
 */
class ReconciliationNode {
  constructor(memoryManager) {
    this.memoryManager = memoryManager;
  }

  /**
   * Compare workspace health and dependencies against current beliefs.
   * If Workspace contradicts Beliefs, Workspace wins unless Goal State explicitly
   * states we are in a migration phase.
   */
  reconcile(workspaceGraph, goalState = null) {
    let paradoxesResolved = 0;

    // 1. Reconcile Package Manager
    if (workspaceGraph.packageManager !== "unknown") {
      const pmBelief = this.memoryManager.getBelief("package_manager");
      if (!pmBelief || pmBelief.currentValue !== workspaceGraph.packageManager) {
        this.memoryManager.updateBelief(
          "package_manager", 
          workspaceGraph.packageManager, 
          1.0, 
          "Reconciliation Node: Hard detection from Workspace Graph"
        );
        paradoxesResolved++;
      }
    }

    // 2. Reconcile Frameworks
    if (workspaceGraph.frameworks.length > 0) {
      const fwBelief = this.memoryManager.getBelief("frameworks");
      const currentFWs = fwBelief ? fwBelief.currentValue : [];
      
      const newFws = workspaceGraph.frameworks.sort().join(',');
      const oldFws = (currentFWs || []).sort().join(',');

      // If goal state explicitly states "migrate to next.js", we should be careful not to overwrite the future state.
      // But for this V1 heuristic, we strictly sync to physical reality if the Goal State doesn't explicitly override.
      if (newFws !== oldFws) {
        let isMigrating = false;
        if (goalState && goalState.title && goalState.title.toLowerCase().includes("migrate")) {
          isMigrating = true;
        }

        if (!isMigrating) {
          this.memoryManager.updateBelief(
            "frameworks", 
            workspaceGraph.frameworks, 
            1.0, 
            "Reconciliation Node: Hard detection from Workspace dependencies"
          );
          paradoxesResolved++;
        }
      }
    }

    // 3. Health Checks
    if (workspaceGraph.workspaceHealth.missingDependencies.length > 0) {
      this.memoryManager.addEpisodicEvent({
        type: "observation",
        critical: true,
        summary: `Workspace is missing dependencies: ${workspaceGraph.workspaceHealth.missingDependencies.join(', ')}`
      });
    }

    return { success: true, paradoxesResolved };
  }
}

module.exports = ReconciliationNode;
