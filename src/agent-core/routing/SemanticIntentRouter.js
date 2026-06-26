const lancedb = require("@lancedb/lancedb");
const path = require("path");
const { SEED_EXAMPLES } = require("./IntentTaxonomy");
// NOTE: On first run, it will download weights from HF, but then cache them.

class SemanticIntentRouter {
  constructor(rootPath) {
    this.dbPath = path.join(rootPath, ".jarvix", "lancedb");
    this.db = null;
    this.table = null;
    this.embedder = null;
    this.tableName = "intent_examples_v3";
  }

  async init() {
    if (!this.embedder) {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = true;
      this.embedder = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        {
          quantized: true,
        },
      );
    }

    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }

    const tableNames = await this.db.tableNames();

    if (!tableNames.includes(this.tableName)) {
      // Seed table
      const data = [];
      for (const ex of SEED_EXAMPLES) {
        const vector = await this.getEmbedding(ex.text);
        data.push({
          id: Math.random().toString(36).substring(7),
          text: ex.text,
          intent: ex.intent,
          vector: Array.from(vector),
        });
      }
      this.table = await this.db.createTable(this.tableName, data);
    } else {
      this.table = await this.db.openTable(this.tableName);
    }
  }

  async getEmbedding(text) {
    const result = await this.embedder(text, {
      pooling: "mean",
      normalize: true,
    });
    return result.data;
  }

  /**
   * Classify user input using semantic similarity
   */
  async classify(text) {
    if (!this.table) await this.init();

    const queryVector = await this.getEmbedding(text);

    // LanceDB L2 distance or Cosine (since normalized, L2 is proportional to Cosine)
    const results = await this.table
      .vectorSearch(Array.from(queryVector))
      .limit(3)
      .toArray();

    if (results.length === 0) return null;

    // Convert L2 distance to a pseudo-confidence score (0 to 1)
    // For normalized vectors, L2 distance is between 0 and 2.
    // Similarity = 1 - (distance^2)/4 is a common mapping, or just 1 - (distance / 2)
    const bestMatch = results[0];

    // The exact distance metric returned depends on LanceDB defaults (usually L2).
    // A distance of 0 means perfect match.
    // We calibrate confidence mapping roughly:
    const distance = bestMatch._distance;
    let confidence = 1.0 - distance / 2.0;
    // Amplify confidence for clarity
    confidence = Math.max(0, Math.min(1, confidence * 1.5));

    return {
      intent: bestMatch.intent,
      confidence: confidence,
      matchedExample: bestMatch.text,
    };
  }

  async addExample(text, intent) {
    if (!this.table) await this.init();
    const vector = await this.getEmbedding(text);
    await this.table.add([
      {
        id: Math.random().toString(36).substring(7),
        text,
        intent,
        vector: Array.from(vector),
      },
    ]);
  }
}

module.exports = { SemanticIntentRouter };
