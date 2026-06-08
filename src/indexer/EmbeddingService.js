/**
 * EmbeddingService — local ONNX-based embedding generation
 *
 * Uses @xenova/transformers (all-MiniLM-L6-v2, 384 dimensions).
 * Runs entirely locally — no API key required.
 * Downloads model on first call (~25MB), then caches it.
 */

let pipeline = null;
let isLoading = false;
let loadPromise = null;

// Dimensions of the all-MiniLM-L6-v2 model
const EMBEDDING_DIM = 384;

/**
 * Lazy-load the embedding pipeline (singleton).
 * Uses dynamic import for ESM-only @xenova/transformers.
 */
async function getEmbeddingPipeline() {
  if (pipeline) return pipeline;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const { pipeline: createPipeline } = await import('@xenova/transformers');
      pipeline = await createPipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { quantized: true }
      );
      return pipeline;
    } catch (err) {
      console.error('[EmbeddingService] Failed to load model:', err.message);
      loadPromise = null;
      throw err;
    }
  })();

  return loadPromise;
}

/**
 * Generate a normalized embedding vector for a text string.
 * Returns a Float32Array of length EMBEDDING_DIM.
 * Falls back to a zero-filled array if the model is unavailable.
 *
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
async function embed(text) {
  try {
    const pipe = await getEmbeddingPipeline();
    // Truncate to ~512 tokens (rough char estimate)
    const truncated = text.slice(0, 2000);
    const result = await pipe(truncated, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  } catch (err) {
    console.warn('[EmbeddingService] Embedding failed, using zeros:', err.message);
    return new Array(EMBEDDING_DIM).fill(0);
  }
}

/**
 * Generate embeddings for a batch of texts.
 * @param {string[]} texts
 * @returns {Promise<Array<number[]>>}
 */
async function embedBatch(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

/**
 * Check if the embedding model is available (already loaded or loadable).
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    await getEmbeddingPipeline();
    return true;
  } catch {
    return false;
  }
}

module.exports = { embed, embedBatch, isAvailable, EMBEDDING_DIM };
