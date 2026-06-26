// src/agent-core/runtime/DslParser.js
/**
 * Lightweight deterministic YAML-like DSL parser for Planner steps.
 * Handles nested blocks, key-value properties, and multiline string blocks.
 */

function parseDSL(dslText) {
  // Clean markdown blocks
  let yamlText = dslText.replace(/```yaml/g, "").replace(/```/g, "").trim();
  
  const lines = yamlText.split("\n");
  const steps = [];
  let currentGroup = [];
  let isParallel = false;
  let currentAction = { capability: "", target: null };
  
  let inStringBlock = false;
  let stringBlockIndent = 0;
  let stringBlockKey = null;
  let stringBlockLines = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("version:") || trimmed.startsWith("plan:") || trimmed.startsWith("---")) continue;

    // Handle multiline string block
    if (inStringBlock) {
      const leadingSpaces = line.search(/\S/);
      if (leadingSpaces >= stringBlockIndent) {
        stringBlockLines.push(line.substring(stringBlockIndent));
        continue;
      } else {
        if (currentAction && stringBlockKey) {
          currentAction[stringBlockKey] = stringBlockLines.join("\n").trim();
        }
        inStringBlock = false;
        stringBlockKey = null;
        stringBlockLines = [];
      }
    }

    const leadingSpaces = line.search(/\S/);

    if (trimmed.startsWith("- parallel")) {
      isParallel = true;
      continue;
    }

    if (trimmed.startsWith("-")) {
      // New action step
      const actionContent = trimmed.substring(1).trim();
      const colonIdx = actionContent.indexOf(":");
      
      currentAction = { capability: "", target: null };
      if (colonIdx !== -1) {
        const key = actionContent.substring(0, colonIdx).trim();
        const val = actionContent.substring(colonIdx + 1).trim();
        
        currentAction.capability = key;
        if (val === "|") {
          inStringBlock = true;
          stringBlockIndent = leadingSpaces + 4;
          stringBlockKey = "target";
        } else if (val) {
          currentAction.target = val.replace(/^['"]|['"]$/g, "");
        }
      } else {
        currentAction.capability = actionContent;
      }

      if (isParallel && leadingSpaces === 6) {
        currentGroup.push(currentAction);
      } else {
        if (currentGroup.length > 0) {
          steps.push({ type: "parallel", actions: currentGroup });
          currentGroup = [];
          isParallel = false;
        }
        if (leadingSpaces === 2) {
          steps.push({ type: "sequential", action: currentAction });
        }
      }
    } else {
      // Key-value pair for currentAction
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1 && currentAction) {
        const key = trimmed.substring(0, colonIdx).trim();
        const val = trimmed.substring(colonIdx + 1).trim();
        
        if (val === "|") {
          inStringBlock = true;
          stringBlockIndent = leadingSpaces + 2;
          stringBlockKey = key;
        } else {
          currentAction[key] = val.replace(/^['"]|['"]$/g, "");
        }
      }
    }
  }

  if (inStringBlock && currentAction && stringBlockKey) {
    currentAction[stringBlockKey] = stringBlockLines.join("\n").trim();
  }

  if (currentGroup.length > 0) {
    steps.push({ type: "parallel", actions: currentGroup });
  }

  return { version: 1, steps };
}

module.exports = { parseDSL };
