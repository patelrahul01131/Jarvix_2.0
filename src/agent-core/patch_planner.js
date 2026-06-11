const fs = require('fs');
const path = require('path');

/**
 * PatchPlanner
 * Validates and applies contextual intents (find/replace, before/insertAfter) 
 * instead of relying on fragile line numbers.
 */
class PatchPlanner {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Generates a concrete patch object from an edit intent.
   * Intent schema expected:
   * {
   *   file: "src/App.jsx",
   *   target: "const count = 0;",
   *   replacement: "const [count, setCount] = useState(0);",
   *   changeExplanation: "..."
   * }
   */
  generatePatch(intent) {
    return {
      file: intent.file,
      target: intent.target,
      replacement: intent.replacement,
      changeExplanation: intent.changeExplanation || "No explanation provided."
    };
  }

  /**
   * Validates if a patch is safe to apply.
   * Checks file existence, target presence, and uniqueness.
   */
  validatePatch(patch) {
    const fullPath = path.isAbsolute(patch.file) 
      ? patch.file 
      : path.join(this.workspaceRoot, patch.file);

    if (!fs.existsSync(fullPath)) {
      return { valid: false, error: `File not found: ${patch.file}` };
    }

    const content = fs.readFileSync(fullPath, 'utf8');

    // Simple target matching for now. We might need to handle whitespace/indentation later.
    if (!patch.target) {
      return { valid: false, error: "Patch target is missing." };
    }

    const occurrences = content.split(patch.target).length - 1;

    if (occurrences === 0) {
      return { valid: false, error: `Target string not found in ${patch.file}. The file may have been modified.` };
    }

    if (occurrences > 1) {
      return { valid: false, error: `Target string is ambiguous. Found ${occurrences} occurrences in ${patch.file}.` };
    }

    return { valid: true, error: null, content };
  }

  /**
   * Applies the patch to the source code and returns the new string.
   * Does NOT write to disk.
   */
  applyPatch(content, patch) {
    // We already know it exists exactly once if validatePatch passed
    return content.replace(patch.target, patch.replacement);
  }
}

module.exports = PatchPlanner;
