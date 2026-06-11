/**
 * Workspace Graph Node
 * Parses project structures to build an architectural understanding
 * and health metric for the planner.
 */

const fs = require('fs');
const path = require('path');

function buildWorkspaceGraph(workspaceRoot) {
  const graph = {
    frameworks: [],
    packageManager: "unknown",
    buildTool: "unknown",
    entryPoints: [],
    dependencies: [],
    scripts: {},
    workspaceHealth: {
      missingDependencies: [],
      brokenScripts: [],
      detectedPackageManager: "unknown",
      gitInitialized: false
    }
  };

  if (!workspaceRoot) return graph;

  try {
    // Check Git
    if (fs.existsSync(path.join(workspaceRoot, '.git'))) {
      graph.workspaceHealth.gitInitialized = true;
    }

    // Check Package Manager
    if (fs.existsSync(path.join(workspaceRoot, 'package-lock.json'))) {
      graph.packageManager = "npm";
      graph.workspaceHealth.detectedPackageManager = "npm";
    } else if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) {
      graph.packageManager = "yarn";
      graph.workspaceHealth.detectedPackageManager = "yarn";
    } else if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
      graph.packageManager = "pnpm";
      graph.workspaceHealth.detectedPackageManager = "pnpm";
    }

    // Parse package.json
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      graph.scripts = pkg.scripts || {};
      
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      graph.dependencies = Object.keys(allDeps);

      // Detect Frameworks & Build Tools
      if (allDeps['react']) graph.frameworks.push("React");
      if (allDeps['next']) graph.frameworks.push("Next.js");
      if (allDeps['express']) graph.frameworks.push("Express");
      if (allDeps['vite']) graph.buildTool = "Vite";
      else if (allDeps['webpack']) graph.buildTool = "Webpack";

      // Detect Entry Points
      if (pkg.main) graph.entryPoints.push(pkg.main);
      
      // Health Check: Missing node_modules
      if (Object.keys(allDeps).length > 0 && !fs.existsSync(path.join(workspaceRoot, 'node_modules'))) {
        graph.workspaceHealth.missingDependencies = Object.keys(allDeps);
      }
    }

    // Look for common entry points if not in package.json
    const commonEntries = ['src/index.js', 'src/main.js', 'src/main.tsx', 'src/index.tsx', 'server.js', 'app.js'];
    for (const entry of commonEntries) {
      if (fs.existsSync(path.join(workspaceRoot, entry)) && !graph.entryPoints.includes(entry)) {
        graph.entryPoints.push(entry);
      }
    }

  } catch (err) {
    console.warn("[WorkspaceGraph] Failed to build graph:", err.message);
  }

  return graph;
}

async function runWorkspaceGraphNode(state, args) {
  if (args.onStatus) {
    args.onStatus(`[${new Date().toLocaleTimeString()}] 🗺️ Building Workspace Graph...`);
  }

  const graph = buildWorkspaceGraph(args.workspaceRoot);

  return {
    workspaceGraph: graph
  };
}

module.exports = { runWorkspaceGraphNode, buildWorkspaceGraph };
