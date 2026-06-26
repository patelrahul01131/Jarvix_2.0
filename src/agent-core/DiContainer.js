// src/agent-core/DiContainer.js
const { SQLiteConnection, TransactionRepository, ArtifactRepository, EventRepository, PermissionRepository } = require("./infrastructure/Repositories");

class DiContainer {
  constructor() {
    this.services = {};
  }

  register(name, instance) {
    this.services[name] = instance;
  }

  get(name) {
    if (!this.services[name]) {
      throw new Error(`[DI Container] Service not found: ${name}`);
    }
    return this.services[name];
  }
}

// Global container instance
const container = new DiContainer();

// Basic Bootstrap
const sqliteConnection = new SQLiteConnection();
container.register("SQLiteConnection", sqliteConnection);

const txRepo = new TransactionRepository(sqliteConnection);
const artRepo = new ArtifactRepository(sqliteConnection);
const eventRepo = new EventRepository(sqliteConnection);
const permRepo = new PermissionRepository(sqliteConnection);

container.register("TransactionRepository", txRepo);
container.register("ArtifactRepository", artRepo);
container.register("EventRepository", eventRepo);
container.register("PermissionRepository", permRepo);

// Register New V7 Runtime Services
const WorkspaceSnapshotManager = require("./runtime/WorkspaceSnapshotManager");
const ChangeEngine = require("./runtime/ChangeEngine");
const WorkspaceLockManager = require("./runtime/WorkspaceLockManager");
const CommitEngine = require("./runtime/CommitEngine");
const { ToolRuntime } = require("./runtime/ToolRuntime");
const ValidationPipeline = require("./runtime/ValidationPipeline");
const Orchestrator = require("./runtime/Orchestrator");

const snapshotMgr = new WorkspaceSnapshotManager({ transactionRepository: txRepo, diContainer: container });
const changeEngine = new ChangeEngine();
const lockMgr = new WorkspaceLockManager();
const commitEngine = new CommitEngine({ lockManager: lockMgr, diContainer: container });
const toolRuntime = new ToolRuntime({ permissionManager: permRepo });
const valPipeline = new ValidationPipeline();
const orchestrator = new Orchestrator({ transactionRepository: txRepo, eventRepository: eventRepo, diContainer: container });

container.register("WorkspaceSnapshotManager", snapshotMgr);
container.register("ChangeEngine", changeEngine);
container.register("WorkspaceLockManager", lockMgr);
container.register("CommitEngine", commitEngine);
container.register("ToolRuntime", toolRuntime);
container.register("ValidationPipeline", valPipeline);
container.register("Orchestrator", orchestrator);

module.exports = container;
