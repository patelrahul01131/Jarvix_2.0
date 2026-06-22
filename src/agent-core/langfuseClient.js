const dotenv = require("dotenv");
const path = require("path");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
const { Langfuse } = require("langfuse");
const { AsyncLocalStorage } = require("async_hooks");

// Initialize AsyncLocalStorage for Trace Context
const traceStorage = new AsyncLocalStorage();

// Initialize Langfuse SDK
// We explicitly pass the keys to sanitize any stray quotes from the .env file
const keys = {
  publicKey: !!process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: !!process.env.LANGFUSE_SECRET_KEY,
  baseUrl: !!process.env.LANGFUSE_HOST,
};

console.log("[Langfuse API Key Status:", keys);

const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_HOST,
});

// Prompt Cache
// Key: promptName, Value: { promptString, timestamp }
const promptCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches a managed prompt from Langfuse with local caching and fallback.
 * @param {string} promptName - The name of the prompt in Langfuse.
 * @param {string} fallbackPrompt - The hardcoded prompt to use if Langfuse fails or is missing.
 * @returns {Promise<string>} The prompt content.
 */
async function getManagedPrompt(promptName, fallbackPrompt) {
  try {
    const now = Date.now();
    const cached = promptCache.get(promptName);

    // Check if cache exists and is fresh
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.promptString;
    }

    // Fetch from Langfuse
    const prompt = await langfuse.getPrompt(promptName, undefined, {
      fallback: fallbackPrompt,
      maxRetries: 1, // Don't hang the loop if Langfuse is down
    });

    // Extract the raw string. In Langfuse v3, prompt.prompt contains the string or Langchain object
    const promptString =
      typeof prompt.prompt === "string"
        ? prompt.prompt
        : prompt.getLangchainPrompt
          ? prompt.getLangchainPrompt()
          : fallbackPrompt;

    // Cache the result
    promptCache.set(promptName, { promptString, timestamp: now });

    return promptString;
  } catch (error) {
    console.warn(
      `[Langfuse] Failed to fetch prompt '${promptName}', using fallback. Error: ${error.message}`,
    );
    return fallbackPrompt;
  }
}

// Ensure events are flushed on exit
process.on("SIGTERM", async () => {
  await langfuse.shutdownAsync();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await langfuse.shutdownAsync();
  process.exit(0);
});

module.exports = {
  langfuse,
  traceStorage,
  getManagedPrompt,
};
