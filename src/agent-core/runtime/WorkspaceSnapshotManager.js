// src/agent-core/runtime/WorkspaceSnapshotManager.js
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Snapshot } = require("../domain/Models");

class WorkspaceSnapshotManager {
  constructor(options = {}) {
    this.txRepo = options.transactionRepository;
    this.di = options.diContainer;
    this.snapshots = new Map(); // snapshotId -> Snapshot
    this.pinnedSnapshots = new Set(); // snapshotId
    this.ttlMs = 3600 * 1000; // 1 hour TTL
  }

  async createSnapshot() {
    let gitHead = "unknown";
    let root = process.env.JARVIX_WORKSPACE_ROOT || process.cwd();
    try {
      const { getWorkspaceRoot } = require("../../tools/fileSystem");
      const wsRoot = getWorkspaceRoot();
      if (wsRoot) root = wsRoot;
    } catch (e) {}

    // Try to get git head hash
    try {
      const gitHeadPath = path.join(root, ".git", "HEAD");
      if (fs.existsSync(gitHeadPath)) {
        const headContent = fs.readFileSync(gitHeadPath, "utf8").trim();
        if (headContent.startsWith("ref:")) {
          const refPath = path.join(root, ".git", headContent.slice(4).trim());
          if (fs.existsSync(refPath)) {
            gitHead = fs.readFileSync(refPath, "utf8").trim();
          }
        } else {
          gitHead = headContent;
        }
      }
    } catch (e) {}

    // Calculate a mock diagnostics version / workspace hash for consistency
    const workspaceHash = crypto.randomUUID();
    const snapshotId = `snap_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const snap = new Snapshot({
      id: snapshotId,
      workspaceHash,
      gitHead,
      diagnosticsVersion: "v1.0.0",
      timestamp: Date.now()
    });

    this.snapshots.set(snapshotId, snap);
    return snap;
  }

  pinSnapshot(snapshotId) {
    if (this.snapshots.has(snapshotId)) {
      this.pinnedSnapshots.add(snapshotId);
    }
  }

  invalidateSnapshot(snapshotId) {
    this.snapshots.delete(snapshotId);
    this.pinnedSnapshots.delete(snapshotId);
  }

  getSnapshot(snapshotId) {
    return this.snapshots.get(snapshotId) || null;
  }

  gc() {
    const now = Date.now();
    for (const [id, snap] of this.snapshots.entries()) {
      if (now - snap.timestamp > this.ttlMs && !this.pinnedSnapshots.has(id)) {
        this.snapshots.delete(id);
      }
    }
  }
}

module.exports = WorkspaceSnapshotManager;
