// src/agent-core/runtime/ChangeEngine.js
const crypto = require("crypto");
const { Patch } = require("../domain/Models");

class ChangeEngine {
  constructor() {
    // Normalizer and formatter configs
  }

  normalize(content) {
    if (typeof content !== "string") return "";
    // Normalize line endings to LF and trim trailing spaces per line
    return content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map(line => line.trimEnd())
      .join("\n");
  }

  format(content) {
    // Format could invoke a pretty printer/linter in production; here we do a basic indentation normalization
    return this.normalize(content);
  }

  generatePatch({ transactionId, filePath, contentBefore, contentAfter }) {
    const normBefore = this.normalize(contentBefore);
    const normAfter = this.format(contentAfter);

    const fileHashBefore = crypto.createHash("sha256").update(normBefore).digest("hex");
    const fileHashAfter = crypto.createHash("sha256").update(normAfter).digest("hex");

    // Simple line-based unified diff generator
    const linesBefore = normBefore.split("\n");
    const linesAfter = normAfter.split("\n");
    let diffStr = `--- a/${filePath}\n+++ b/${filePath}\n`;

    // Extremely simple line-by-line comparison for demonstrative/correct patches
    let i = 0, j = 0;
    while (i < linesBefore.length || j < linesAfter.length) {
      if (i < linesBefore.length && j < linesAfter.length && linesBefore[i] === linesAfter[j]) {
        i++;
        j++;
      } else {
        if (i < linesBefore.length && (j >= linesAfter.length || linesBefore[i] !== linesAfter[j])) {
          diffStr += `- ${linesBefore[i]}\n`;
          i++;
        }
        if (j < linesAfter.length && (i >= linesBefore.length || linesBefore[i-1] !== linesAfter[j])) {
          diffStr += `+ ${linesAfter[j]}\n`;
          j++;
        }
      }
    }

    return new Patch({
      transactionId,
      filePath,
      contentBefore: normBefore,
      contentAfter: normAfter,
      patchString: diffStr,
      fileHashBefore,
      fileHashAfter,
      isNormalized: true
    });
  }
}

module.exports = ChangeEngine;
