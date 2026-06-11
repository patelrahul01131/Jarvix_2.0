const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * DiffManager
 * Handles patch grouping, risk calculation, summarization, and human-in-the-loop approval.
 */
class DiffManager {
  constructor(workspaceRoot, eventBus) {
    this.workspaceRoot = workspaceRoot;
    this.eventBus = eventBus;
  }

  /**
   * Groups individual valid patches into a transactional group for approval.
   */
  groupChanges(patches) {
    const group = {
      id: `pg_${Date.now()}`,
      patches: patches,
      risk: this.calculateRisk(patches),
      summary: this.summarizeChanges(patches)
    };
    return group;
  }

  /**
   * Calculates the risk level of the patch group to determine if it needs separate approvals.
   */
  calculateRisk(patches) {
    let risk = "LOW";
    const highRiskFiles = ['package.json', 'package-lock.json', '.env', 'docker-compose.yml', 'webpack.config.js'];
    
    for (const patch of patches) {
      const fileName = path.basename(patch.file).toLowerCase();
      if (highRiskFiles.includes(fileName)) {
        risk = "HIGH";
      }
      if (patch.intent === "delete" || patch.intent === "destroy") {
        risk = "HIGH";
      }
    }
    return risk;
  }

  /**
   * Summarizes the changes in a human-readable format.
   */
  summarizeChanges(patches) {
    const numFiles = patches.length;
    let summary = `Modifying ${numFiles} file${numFiles > 1 ? 's' : ''}.\n`;
    patches.forEach(p => {
      summary += `• ${path.basename(p.file)}: ${p.changeExplanation || 'Updated'}\n`;
    });
    return summary;
  }

  /**
   * Requests human approval for a Patch Group.
   * If there's 1 patch, it shows a VS Code Diff window.
   * If multiple, it summarizes and asks for bulk approval.
   */
  async requestApproval(patchGroup, currentContentMap) {
    // Emit event that we are waiting for approval
    if (this.eventBus) {
      this.eventBus.emitEvent('WAITING_FOR_APPROVAL', { patchGroup });
    }

    // Prepare temp files for diff view
    let firstPatch = patchGroup.patches[0];
    let approved = false;
    let rejectionReason = null;

    try {
      const fullPath = path.isAbsolute(firstPatch.file) ? firstPatch.file : path.join(this.workspaceRoot, firstPatch.file);
      const originalUri = vscode.Uri.file(fullPath);
      
      const newContent = currentContentMap[firstPatch.file].newContent;
      const tempPath = path.join(os.tmpdir(), `jarvix_preview_${path.basename(firstPatch.file)}`);
      fs.writeFileSync(tempPath, newContent, 'utf8');
      const tempUri = vscode.Uri.file(tempPath);

      // Open Diff View
      await vscode.commands.executeCommand('vscode.diff', originalUri, tempUri, `Jarvix Proposal: ${path.basename(firstPatch.file)}`);

      // Ask for approval
      const selection = await vscode.window.showInformationMessage(
        `Jarvix wants to apply these changes. ${patchGroup.risk === 'HIGH' ? '⚠️ HIGH RISK' : ''}\n\n${patchGroup.summary}`,
        { modal: true },
        'Approve',
        'Reject (Wrong File)',
        'Reject (Wrong Implementation)',
        'Reject (Other)'
      );

      if (selection === 'Approve') {
        approved = true;
      } else {
        rejectionReason = selection;
      }

    } catch (e) {
      console.error("[DiffManager] Error during approval request:", e);
      rejectionReason = "Diff view failed or timed out.";
    }

    if (this.eventBus) {
      this.eventBus.emitEvent(approved ? 'PATCH_APPROVED' : 'PATCH_REJECTED', { 
        patchGroupId: patchGroup.id,
        reason: rejectionReason
      });
    }

    return { approved, rejectionReason };
  }
}

module.exports = DiffManager;
