// src/agent-core/runtime/ValidationPipeline.js
const fs = require("fs");
const path = require("path");

class ValidationPipeline {
  constructor() {
    this.stages = [];
    this.initializeDefaultStages();
  }

  initializeDefaultStages() {
    // Stage 1: Syntax stage
    this.registerStage("Syntax", async (filePath, content) => {
      const ext = path.extname(filePath);
      if (ext === ".js" || ext === ".json") {
        try {
          if (ext === ".json") {
            JSON.parse(content);
          } else {
            // Quick syntax validate using Function constructor (runs in sandbox without executing)
            new Function(content);
          }
          return { success: true };
        } catch (err) {
          return { success: false, error: `Syntax Error: ${err.message}` };
        }
      }
      return { success: true };
    });

    // Stage 2: Formatter stage
    this.registerStage("Formatter", async (filePath, content) => {
      // Formatter validation (e.g., ensuring no bad trailing whitespaces)
      if (content.includes("\r")) {
        return { success: true, warning: "Windows CRLF line endings detected." };
      }
      return { success: true };
    });

    // Stage 3: Linter stage
    this.registerStage("Linter", async (filePath, content) => {
      // Mock lint step
      return { success: true };
    });
  }

  registerStage(name, runFn) {
    this.stages.push({ name, runFn });
  }

  async run(filePath, content, profile = "Standard") {
    const results = [];
    let overallSuccess = true;

    // Filter stages based on validation profile
    let activeStages = [...this.stages];
    if (profile === "Quick") {
      activeStages = this.stages.filter(s => s.name === "Syntax");
    }

    for (const stage of activeStages) {
      try {
        const res = await stage.runFn(filePath, content);
        results.push({ stageName: stage.name, ...res });
        if (res.success === false) {
          overallSuccess = false;
        }
      } catch (err) {
        results.push({ stageName: stage.name, success: false, error: err.message });
        overallSuccess = false;
      }
    }

    return {
      success: overallSuccess,
      profile,
      stages: results
    };
  }
}

module.exports = ValidationPipeline;
