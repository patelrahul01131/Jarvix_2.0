// src/agent-core/domain/Models.js
/**
 * Canonical Domain Models for Jarvix OS V7
 * Implemented as immutable objects (frozen).
 */

class Transaction {
  constructor({ id, state, createdTime, updatedTime, workerId, permissionScopes, resourceCost, metadata = {} }) {
    this.id = id;
    this.state = state; // CREATED, PLANNING, WAITING_PERMISSION, RUNNING, WAITING_REVIEW, COMMITTING, COMMITTED, FAILED, ROLLED_BACK, CANCELLED
    this.createdTime = createdTime || Date.now();
    this.updatedTime = updatedTime || Date.now();
    this.workerId = workerId || null;
    this.permissionScopes = permissionScopes || [];
    this.resourceCost = resourceCost || 0;
    this.metadata = metadata;
    Object.freeze(this);
  }
}

class Workflow {
  constructor({ transactionId, nodes, edges, metadata = {} }) {
    this.transactionId = transactionId;
    this.nodes = nodes || []; // Array of execution steps
    this.edges = edges || []; // Array of directed dependencies
    this.metadata = metadata;
    Object.freeze(this);
  }
}

class ExecutionStep {
  constructor({ id, capability, inputs, outputs, dependencies, retryPolicy, timeout, permissionScope, expectedArtifacts, estimatedCost, status = "pending" }) {
    this.id = id;
    this.capability = capability;
    this.inputs = inputs || {};
    this.outputs = outputs || {};
    this.dependencies = dependencies || [];
    this.retryPolicy = retryPolicy || { maxRetries: 3, backoffMs: 1000 };
    this.timeout = timeout || 30000;
    this.permissionScope = permissionScope || null;
    this.expectedArtifacts = expectedArtifacts || [];
    this.estimatedCost = estimatedCost || 0;
    this.status = status;
    Object.freeze(this);
  }
}

class Patch {
  constructor({ transactionId, filePath, contentBefore, contentAfter, patchString, fileHashBefore, fileHashAfter, isNormalized = false }) {
    this.transactionId = transactionId;
    this.filePath = filePath;
    this.contentBefore = contentBefore;
    this.contentAfter = contentAfter;
    this.patchString = patchString;
    this.fileHashBefore = fileHashBefore;
    this.fileHashAfter = fileHashAfter;
    this.isNormalized = isNormalized;
    Object.freeze(this);
  }
}

class Artifact {
  constructor({ id, transactionId, type, path, content, format, sequence, metadata = {} }) {
    this.id = id;
    this.transactionId = transactionId;
    this.type = type; // PATCH, BINARY, REPORT, SEARCH, TERMINAL
    this.path = path;
    this.content = content;
    this.format = format;
    this.sequence = sequence;
    this.metadata = metadata;
    Object.freeze(this);
  }
}

class Permission {
  constructor({ id, transactionId, scope, status, requestedTime, decidedTime, reason }) {
    this.id = id;
    this.transactionId = transactionId;
    this.scope = scope; // e.g. "Workspace.Write:file.js"
    this.status = status; // PENDING, GRANTED, DENIED
    this.requestedTime = requestedTime || Date.now();
    this.decidedTime = decidedTime || null;
    this.reason = reason || "";
    Object.freeze(this);
  }
}

class Snapshot {
  constructor({ id, workspaceHash, gitHead, diagnosticsVersion, timestamp }) {
    this.id = id;
    this.workspaceHash = workspaceHash;
    this.gitHead = gitHead;
    this.diagnosticsVersion = diagnosticsVersion;
    this.timestamp = timestamp || Date.now();
    Object.freeze(this);
  }
}

class Worker {
  constructor({ id, state, currentTransactionId, resourceLeaseIds = [] }) {
    this.id = id;
    this.state = state; // Idle, Reserved, Running, Paused, Cancelled, Restarting, Dead
    this.currentTransactionId = currentTransactionId || null;
    this.resourceLeaseIds = resourceLeaseIds;
    Object.freeze(this);
  }
}

class Capability {
  constructor({ id, description, requiredPermissions, pluginId, version }) {
    this.id = id;
    this.description = description;
    this.requiredPermissions = requiredPermissions || [];
    this.pluginId = pluginId;
    this.version = version;
    Object.freeze(this);
  }
}

class ExecutionResult {
  constructor({ success, output, error, duration, metrics = {} }) {
    this.success = success;
    this.output = output;
    this.error = error || null;
    this.duration = duration;
    this.metrics = metrics;
    Object.freeze(this);
  }
}

module.exports = {
  Transaction,
  Workflow,
  ExecutionStep,
  Patch,
  Artifact,
  Permission,
  Snapshot,
  Worker,
  Capability,
  ExecutionResult
};
