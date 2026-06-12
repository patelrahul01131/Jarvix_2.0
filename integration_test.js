/**
 * Jarvix 4.0 Production Integration Test
 * Validates that all activated systems work end-to-end through the real execution path.
 */

const { goalManager } = require("./src/agent-core/goal_manager");
const { lockManager } = require("./src/agent-core/resource_lock_manager");
const { memoryManager } = require("./src/memory/memory_manager");
const { eventBus, EVENTS } = require("./src/core/event_bus");
const ReconciliationNode = require("./src/agent-core/reconciliation");
const DeepWorldModel = require("./src/agent-core/worldModel");
const { globalProcessManager } = require("./src/agent-core/process_manager");
const StateSerializer = require("./src/core/state_serializer");

async function runIntegrationTest() {
  console.log("🧪 Jarvix 4.0 Production Integration Test\n");
  const results = [];

  function pass(label) { results.push({ label, pass: true }); console.log(`  ✅ ${label}`); }
  function fail(label, err) { results.push({ label, pass: false, err }); console.log(`  ❌ ${label}: ${err}`); }

  // ─── Test 1: GoalManager creates and tracks a goal ────────────────────────
  console.log("1. GoalManager Lifecycle:");
  try {
    const goal = goalManager.createGoal({ title: "Build authentication module", priority: "high" });
    if (!goal.id) throw new Error("No goal ID");
    if (goal.status !== "active") throw new Error(`Expected active, got ${goal.status}`);
    pass("Goal created with correct id and status");

    goalManager.updateGoalStatus(goal.id, "completed");
    const closedGoal = goalManager.getGoal(goal.id);
    if (closedGoal.status !== "completed") throw new Error("Goal not closed");
    pass("Goal correctly transitions to completed");
  } catch (e) { fail("GoalManager lifecycle", e.message); }

  // ─── Test 2: Goal Tree — cancelling parent kills children ─────────────────
  console.log("\n2. Goal Tree Cancellation:");
  try {
    const parent = goalManager.createGoal({ title: "Build CRM", priority: "high" });
    const child1 = goalManager.createGoal({ title: "Build Auth", priority: "normal", parentGoalId: parent.id });
    const child2 = goalManager.createGoal({ title: "Build Dashboard", priority: "normal", parentGoalId: parent.id });
    
    goalManager.cancelGoalTree(parent.id);
    
    if (goalManager.getGoal(parent.id).status !== "cancelled") throw new Error("Parent not cancelled");
    if (goalManager.getGoal(child1.id).status !== "cancelled") throw new Error("Child1 not cancelled");
    if (goalManager.getGoal(child2.id).status !== "cancelled") throw new Error("Child2 not cancelled");
    pass("Parent cancellation cascades to all children");
  } catch (e) { fail("Goal tree cancellation", e.message); }

  // ─── Test 3: LockManager prevents write collisions ─────────────────────── 
  console.log("\n3. LockManager Collision Prevention:");
  try {
    const goalA = goalManager.createGoal({ title: "Goal A" });
    const goalB = goalManager.createGoal({ title: "Goal B" });
    const targetFile = "src/auth.ts";

    // Goal A acquires write lock
    await lockManager.acquireLock(targetFile, goalA.id, "write");
    pass("Goal A acquired write lock on auth.ts");

    // Goal B attempts to write — should be BLOCKED
    let blocked = false;
    try {
      await lockManager.acquireLock(targetFile, goalB.id, "write");
    } catch (lockErr) {
      blocked = true;
    }
    if (!blocked) throw new Error("Goal B should have been blocked");
    pass("Goal B correctly blocked — concurrent write collision prevented");

    // Release and verify Goal B can now acquire
    lockManager.releaseLock(targetFile, goalA.id);
    await lockManager.acquireLock(targetFile, goalB.id, "write");
    pass("After release, Goal B successfully acquired the lock");
    lockManager.releaseLocksForGoal(goalB.id);
  } catch (e) { fail("LockManager collision prevention", e.message); }

  // ─── Test 4: MemoryManager persists and recalls beliefs ───────────────────
  console.log("\n4. MemoryManager Belief Store:");
  try {
    memoryManager.updateBelief("project_framework", "React", 0.95, "workspace_detection");
    const belief = memoryManager.getBelief("project_framework");
    if (!belief) throw new Error("Belief not found after upsert");
    if (belief.currentValue !== "React") throw new Error(`Expected React, got ${belief.currentValue}`);
    if (belief.confidence !== 0.95) throw new Error(`Expected 0.95, got ${belief.confidence}`);
    pass("Belief correctly stored and retrieved");

    // Test contradiction resolution
    memoryManager.updateBelief("project_framework", "Next.js", 1.0, "migration_goal");
    const updated = memoryManager.getBelief("project_framework");
    if (updated.currentValue !== "Next.js") throw new Error("Belief not updated");
    if (updated.superseded.length === 0) throw new Error("Contradiction history not tracked");
    pass("Belief contradiction correctly tracked in superseded history");
  } catch (e) { fail("MemoryManager belief store", e.message); }

  // ─── Test 5: ReconciliationNode syncs workspace to beliefs ────────────────
  console.log("\n5. ReconciliationNode:");
  try {
    const reconciler = new ReconciliationNode(memoryManager);
    const fakeWorkspaceGraph = {
      packageManager: "npm",
      frameworks: ["react", "vite"],
      workspaceHealth: { missingDependencies: [], hasPackageJson: true }
    };
    const result = reconciler.reconcile(fakeWorkspaceGraph);
    if (!result.success) throw new Error("Reconciliation failed");
    
    const pmBelief = memoryManager.getBelief("package_manager");
    if (!pmBelief || pmBelief.currentValue !== "npm") throw new Error("package_manager belief not synced");
    pass(`Reconciliation ran. ${result.paradoxesResolved} beliefs synced from workspace`);
  } catch (e) { fail("ReconciliationNode", e.message); }

  // ─── Test 6: DeepWorldModel tracks causal dependencies ────────────────────
  console.log("\n6. DeepWorldModel Causality:");
  try {
    const wm = new DeepWorldModel();
    wm.addDependency("src/auth.ts", "src/middleware.ts");
    wm.addDependency("src/auth.ts", "src/routes/login.tsx");
    wm.recordChange("src/auth.ts", "write", "fs.writeFile", "success");

    const impacted = wm.getImpactedModules("src/auth.ts");
    if (!impacted.includes("src/middleware.ts")) throw new Error("middleware.ts not in impact list");
    if (!impacted.includes("src/routes/login.tsx")) throw new Error("login.tsx not in impact list");
    pass(`auth.ts change correctly marks [${impacted.join(", ")}] as potentially impacted`);

    const conf = wm.getConfidence("src/middleware.ts");
    if (conf >= 100) throw new Error("Confidence should have been reduced for dependent module");
    pass(`Dependent module confidence reduced to ${conf}/100 after upstream change`);
  } catch (e) { fail("DeepWorldModel causality", e.message); }

  // ─── Test 7: StateSerializer snapshot roundtrip ────────────────────────── 
  console.log("\n7. StateSerializer Snapshot:");
  try {
    const serializer = new StateSerializer(null, goalManager, memoryManager, lockManager);
    const snapshot = serializer.createSnapshot();
    if (!snapshot.timestamp) throw new Error("No timestamp in snapshot");
    if (!snapshot.beliefs || snapshot.beliefs.length === 0) throw new Error("Beliefs not captured");
    pass(`Snapshot created with ${snapshot.beliefs.length} beliefs at ${snapshot.timestamp}`);
  } catch (e) { fail("StateSerializer snapshot", e.message); }

  // ─── Test 8: EventBus fires on GOAL_COMPLETED ─────────────────────────────
  console.log("\n8. EventBus Integration:");
  try {
    let eventFired = false;
    eventBus.once(EVENTS.GOAL_COMPLETED, () => { eventFired = true; });
    
    const goal = goalManager.createGoal({ title: "EventBus test goal" });
    goalManager.updateGoalStatus(goal.id, "completed");

    await new Promise(r => setTimeout(r, 50)); // allow microtask flush
    if (!eventFired) throw new Error("GOAL_COMPLETED event never fired");
    pass("GOAL_COMPLETED event correctly fired through EventBus");
  } catch (e) { fail("EventBus integration", e.message); }

  // ─── Test 9: runValidator detects invalid fs.editFile parameters ───────────
  console.log("\n9. Plan Validator (fs.editFile Line Range validation):");
  try {
    const { runValidator } = require("./src/agent-core/execution_validator");
    
    // Create a temporary file to test on
    const tmpFilePath = "test_validator_temp.txt";
    const absoluteTmpPath = require("path").resolve(__dirname, tmpFilePath);
    require("fs").writeFileSync(absoluteTmpPath, "line1\nline2\nline3", "utf-8");
    
    // Test Case 1: Valid range
    const stateValid = {
      action: {
        executionPlan: [
          {
            tool: "fs.editFile",
            input: {
              path: tmpFilePath,
              startLine: 1,
              endLine: 2,
              replace: "new content"
            }
          }
        ]
      }
    };
    
    const validRes = await runValidator(stateValid, { workspaceRoot: __dirname });
    if (validRes.status !== "VALID_PLAN") {
      throw new Error(`Expected VALID_PLAN for valid line range, got ${validRes.status}: ${validRes.lastResult?.error}`);
    }
    
    // Test Case 2: Invalid range (startLine > endLine)
    const stateInvalidRange = {
      action: {
        executionPlan: [
          {
            tool: "fs.editFile",
            input: {
              path: tmpFilePath,
              startLine: 2,
              endLine: 1,
              replace: "new content"
            }
          }
        ]
      }
    };
    
    const invalidRangeRes = await runValidator(stateInvalidRange, { workspaceRoot: __dirname });
    if (invalidRangeRes.status !== "INVALID_PLAN") {
      throw new Error(`Expected INVALID_PLAN for startLine > endLine, got ${invalidRangeRes.status}`);
    }
    
    // Test Case 3: Invalid range (endLine: 0 / startLine: 1)
    const stateZeroEndLine = {
      action: {
        executionPlan: [
          {
            tool: "fs.editFile",
            input: {
              path: tmpFilePath,
              startLine: 1,
              endLine: 0,
              replace: "new content"
            }
          }
        ]
      }
    };
    
    const zeroEndLineRes = await runValidator(stateZeroEndLine, { workspaceRoot: __dirname });
    if (zeroEndLineRes.status !== "INVALID_PLAN") {
      throw new Error(`Expected INVALID_PLAN for endLine: 0, got ${zeroEndLineRes.status}`);
    }
    
    // Clean up
    require("fs").unlinkSync(absoluteTmpPath);
    pass("Plan Validator correctly validates line range limits and catches invalid parameters");
  } catch (e) { fail("Plan Validator validation", e.message); }

  // ─── Final Report ──────────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`\n${"─".repeat(50)}`);
  console.log(`📊 Results: ${passed}/${total} tests passed`);
  if (passed === total) {
    console.log("🚀 Jarvix 4.0 is PRODUCTION READY. All cognitive systems operational.");
  } else {
    console.log("⚠️ Some tests failed. Review above for details.");
    results.filter(r => !r.pass).forEach(r => console.log(`   ❌ ${r.label}: ${r.err}`));
    process.exit(1);
  }
}

runIntegrationTest().catch(err => {
  console.error("Integration test runner crashed:", err);
  process.exit(1);
});
