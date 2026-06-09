/**
 * The Deep World Model
 * Represents the agent's internalized, temporally-aware, and causally-linked 
 * understanding of the software environment.
 */

class DeepWorldModel {
  constructor() {
    this.semanticAbstractions = {}; // System meaning layer (e.g., "auth.js handles JWT logic")
    this.causalityGraph = {};       // Dependency graph (A breaks if B changes)
    this.temporalState = [];        // Action history (when things changed and why)
    this.confidenceScores = {};     // How sure the agent is about a module's state (0-100)
  }

  // ─── Semantic Abstraction Layer ─────────────────────────────────────────
  /**
   * Tracks the system meaning, what modules do, system behavior intent, and architecture roles.
   */
  updateSemanticAbstraction(moduleId, { purpose, intent, roles }) {
    if (!this.semanticAbstractions[moduleId]) {
      this.semanticAbstractions[moduleId] = { purpose: "", intent: "", roles: [] };
    }
    if (purpose) this.semanticAbstractions[moduleId].purpose = purpose;
    if (intent) this.semanticAbstractions[moduleId].intent = intent;
    if (roles) this.semanticAbstractions[moduleId].roles = roles;

    // Reset confidence because we learned something new or updated our belief
    this.updateConfidence(moduleId, 80); 
  }

  getSemanticAbstraction(moduleId) {
    return this.semanticAbstractions[moduleId] || null;
  }

  // ─── Causal Relationships (Dependency Graph Engine) ─────────────────────
  /**
   * Tracks that targetModule depends on sourceModule.
   * If sourceModule changes, targetModule might break.
   */
  addDependency(sourceModule, targetModule) {
    if (!this.causalityGraph[sourceModule]) {
      this.causalityGraph[sourceModule] = { impacts: new Set(), dependsOn: new Set() };
    }
    if (!this.causalityGraph[targetModule]) {
      this.causalityGraph[targetModule] = { impacts: new Set(), dependsOn: new Set() };
    }
    this.causalityGraph[sourceModule].impacts.add(targetModule);
    this.causalityGraph[targetModule].dependsOn.add(sourceModule);
  }

  /**
   * Returns a list of all modules that might break if the given module is changed.
   */
  getImpactedModules(moduleId) {
    if (!this.causalityGraph[moduleId]) return [];
    return Array.from(this.causalityGraph[moduleId].impacts);
  }

  // ─── Temporal State ─────────────────────────────────────────────────────
  /**
   * Tracks when things changed to construct an action history graph.
   */
  recordChange(moduleId, action, toolUsed, resultSummary) {
    this.temporalState.push({
      timestamp: Date.now(),
      moduleId,
      action,
      toolUsed,
      resultSummary
    });
    
    // A recent change reduces confidence in dependent modules
    const impacted = this.getImpactedModules(moduleId);
    for (const dep of impacted) {
      this.updateConfidence(dep, Math.max(0, (this.confidenceScores[dep] || 100) - 30));
    }
    
    // Changing the module itself sets confidence high because we just verified it
    this.updateConfidence(moduleId, 100);
  }

  getHistory(moduleId) {
    return this.temporalState.filter(entry => entry.moduleId === moduleId);
  }

  // ─── Confidence Scores ──────────────────────────────────────────────────
  /**
   * Tracks how sure the agent is about the codebase state.
   */
  updateConfidence(moduleId, score) {
    this.confidenceScores[moduleId] = Math.max(0, Math.min(100, score));
  }

  getConfidence(moduleId) {
    return this.confidenceScores[moduleId] !== undefined ? this.confidenceScores[moduleId] : 0;
  }

  // ─── Export/Import ──────────────────────────────────────────────────────
  serialize() {
    const serializedCausality = {};
    for (const [key, value] of Object.entries(this.causalityGraph)) {
      serializedCausality[key] = {
        impacts: Array.from(value.impacts),
        dependsOn: Array.from(value.dependsOn)
      };
    }
    return {
      semanticAbstractions: this.semanticAbstractions,
      causalityGraph: serializedCausality,
      temporalState: this.temporalState,
      confidenceScores: this.confidenceScores
    };
  }

  deserialize(data) {
    if (!data) return;
    this.semanticAbstractions = data.semanticAbstractions || {};
    this.temporalState = data.temporalState || [];
    this.confidenceScores = data.confidenceScores || {};
    
    if (data.causalityGraph) {
      for (const [key, value] of Object.entries(data.causalityGraph)) {
        this.causalityGraph[key] = {
          impacts: new Set(value.impacts || []),
          dependsOn: new Set(value.dependsOn || [])
        };
      }
    }
  }
}

module.exports = DeepWorldModel;
