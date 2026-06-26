'use strict';

const fs = require('fs');
const path = require('path');

/**
 * @typedef {Object} GraphNode
 * @property {string} id - Absolute or relative file path
 * @property {"file" | "component" | "function"} type
 * @property {string[]} imports - List of file paths this node imports
 * @property {string[]} exports - List of symbols exported
 * @property {string[]} dependencies - List of package dependencies
 */

class WorkspaceGraph {
  constructor() {
    /** @type {Map<string, GraphNode>} */
    this.nodes = new Map();
    this.isBuilt = false;
  }

  /**
   * Initializes the workspace graph (Mock build for Phase 3)
   * In a full implementation, this uses AST parsing to build the true graph.
   * @param {string} workspaceRoot 
   */
  async build(workspaceRoot) {
    if (this.isBuilt) return;
    console.log(`[WorkspaceGraph] Building graph for root: ${workspaceRoot}`);

    // Mock graph population for Phase 3 structure demonstration
    this.nodes.set('LoginPage', {
      id: 'LoginPage',
      type: 'component',
      imports: ['AuthService', 'ButtonComponent'],
      exports: ['LoginPage'],
      dependencies: ['react']
    });

    this.nodes.set('AuthService', {
      id: 'AuthService',
      type: 'function',
      imports: ['ApiClient'],
      exports: ['login', 'logout'],
      dependencies: ['axios', 'jsonwebtoken']
    });

    this.nodes.set('ApiClient', {
      id: 'ApiClient',
      type: 'function',
      imports: [],
      exports: ['get', 'post'],
      dependencies: ['axios']
    });

    this.isBuilt = true;
  }

  /**
   * Traversing the graph to find immediate dependencies
   * @param {string} nodeId 
   * @param {number} depth 
   * @returns {GraphNode[]}
   */
  traverseDependencies(nodeId, depth = 1) {
    const results = new Map();
    const queue = [{ id: nodeId, currentDepth: 0 }];

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift();
      if (currentDepth > depth) continue;

      const node = this.nodes.get(id);
      if (node && id !== nodeId) {
        results.set(id, node);
      }

      if (node && currentDepth < depth) {
        node.imports.forEach(imp => {
          if (!results.has(imp)) {
            queue.push({ id: imp, currentDepth: currentDepth + 1 });
          }
        });
      }
    }

    return Array.from(results.values());
  }

  /**
   * Searches the graph using a keyword to find relevant nodes
   * @param {string} keyword 
   * @returns {GraphNode[]}
   */
  search(keyword) {
    const results = [];
    const lowerKeyword = keyword.toLowerCase();
    
    for (const [id, node] of this.nodes.entries()) {
      if (id.toLowerCase().includes(lowerKeyword) || 
          node.exports.some(e => e.toLowerCase().includes(lowerKeyword))) {
        results.push(node);
      }
    }
    return results;
  }
}

const workspaceGraph = new WorkspaceGraph();
module.exports = { workspaceGraph, WorkspaceGraph };
