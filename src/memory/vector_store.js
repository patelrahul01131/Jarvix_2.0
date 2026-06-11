/**
 * Vector Store
 * Handles Semantic Memory via Local Embeddings.
 * V1 Implementation: @xenova/transformers + hnswlib-node (or pure JS equivalent)
 */

class VectorStore {
  constructor() {
    this.modelName = 'Xenova/all-MiniLM-L6-v2';
    this.extractor = null;
    this.index = null; // HNSW index
    this.memoryDocs = new Map(); // Map<docId, payload>
    this.isReady = false;
  }

  async init() {
    if (this.isReady) return;
    
    // Dynamic import to allow graceful degradation if dependencies are missing
    try {
      const { pipeline } = await import('@xenova/transformers');
      this.extractor = await pipeline('feature-extraction', this.modelName);
      
      // Initialize an empty vector index (assuming 384 dimensions for all-MiniLM-L6-v2)
      // In a real implementation, we would instantiate hnswlib here.
      // For now, we will maintain an array of vectors for pure JS cosine similarity as fallback.
      this.vectors = []; 
      
      this.isReady = true;
    } catch (err) {
      console.warn("[VectorStore] Initialization failed. Semantic search will be unavailable.", err.message);
    }
  }

  async addDocument(id, text, payload = {}) {
    if (!this.isReady) await this.init();
    if (!this.isReady) return;

    try {
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      const vector = Array.from(output.data);
      
      this.vectors.push({ id, vector });
      this.memoryDocs.set(id, { text, ...payload });
      
    } catch (err) {
      console.error("[VectorStore] Failed to add document:", err);
    }
  }

  async search(query, limit = 5) {
    if (!this.isReady) await this.init();
    if (!this.isReady || this.vectors.length === 0) return [];

    try {
      const output = await this.extractor(query, { pooling: 'mean', normalize: true });
      const queryVector = Array.from(output.data);
      
      // Basic Cosine Similarity (Fallback if hnswlib is not used)
      const results = this.vectors.map(item => {
        const similarity = this._cosineSimilarity(queryVector, item.vector);
        return {
          id: item.id,
          similarity,
          ...this.memoryDocs.get(item.id)
        };
      });

      // Sort descending by similarity
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, limit);
      
    } catch (err) {
      console.error("[VectorStore] Search failed:", err);
      return [];
    }
  }

  _cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Singleton
const vectorStore = new VectorStore();

module.exports = { VectorStore, vectorStore };
