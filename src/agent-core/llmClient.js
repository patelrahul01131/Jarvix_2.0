/**
 * LLM Client
 * Communicates with the local Jarvix Express bridge to fetch LLM completions.
 */

const axios = require("axios");
const { traceStorage } = require("./langfuseClient");

const BRIDGE_URL = "http://127.0.0.1:3131/chat";

async function callLLM({ messages, system, model, provider, onChunk, signal }) {
  const trace = traceStorage.getStore();
  let generation = null;
  if (trace) {
    generation = trace.generation({
      name: "llm-completion",
      model: "llama-3.1-8b-instant",
      modelParameters: { provider: "groq" },
      input: [{ role: "system", content: system }, ...(messages || [])],
    });
  }

  return new Promise((resolve, reject) => {
    axios
      .post(
        BRIDGE_URL,
        { messages, system, model, provider },
        {
          responseType: "stream",
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          signal,
        },
      )
      .then((response) => {
        let buffer = "";
        let reply = "";
        let tokenUsage = null;

        response.data.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const dataStr = trimmed.replace(/^data:\s*/, "");
            if (dataStr === "[DONE]") continue;
            try {
              const json = JSON.parse(dataStr);
              if (json.text) {
                reply += json.text;
                if (onChunk) onChunk(json.text);
              }
              if (json.usage) tokenUsage = json.usage;
            } catch (e) {}
          }
        });

        response.data.on("end", () => {
          if (generation) {
            generation.end({
              output: reply,
              usage: tokenUsage
                ? {
                    promptTokens: tokenUsage.prompt_tokens,
                    completionTokens: tokenUsage.completion_tokens,
                    totalTokens: tokenUsage.total_tokens,
                  }
                : undefined,
            });
          }
          resolve({ reply, tokenUsage });
        });

        response.data.on("error", (err) => {
          if (generation) {
            generation.end({ level: "ERROR", statusMessage: err.message });
          }
          reject(new Error(`Stream error: ${err.message}`));
        });
      })
      .catch((err) => {
        if (
          axios.isCancel(err) ||
          err.name === "AbortError" ||
          err.code === "ERR_CANCELED"
        ) {
          reject(
            Object.assign(new Error("Generation aborted"), {
              name: "AbortError",
            }),
          );
          return;
        }

        if (
          err.response &&
          err.response.data &&
          typeof err.response.data.on === "function"
        ) {
          let errBody = "";
          err.response.data.on(
            "data",
            (chunk) => (errBody += chunk.toString()),
          );
          err.response.data.on("end", () => {
            try {
              const json = JSON.parse(errBody);
              if (generation)
                generation.end({
                  level: "ERROR",
                  statusMessage: json.error || err.message,
                });
              reject(new Error(json.error || err.message));
            } catch (e) {
              if (generation)
                generation.end({
                  level: "ERROR",
                  statusMessage: errBody || err.message,
                });
              reject(new Error(errBody || err.message));
            }
          });
        } else {
          if (generation)
            generation.end({ level: "ERROR", statusMessage: err.message });
          reject(err);
        }
      });
  });
}

/**
 * callLLM with exponential backoff retry for HTTP 429 rate-limit errors.
 * Waits 2s → 4s → 8s before giving up (3 retries total).
 */
async function callLLMWithRetry(params, _attempt = 0) {
  const MAX_RETRIES = 5;
  const BASE_DELAY_MS = 2000;

  try {
    return await callLLM(params);
  } catch (err) {
    const is429 =
      err.message &&
      (err.message.includes("429") ||
        err.message.toLowerCase().includes("rate limit") ||
        err.message.toLowerCase().includes("too many requests") ||
        err.message.toLowerCase().includes("rate_limit"));

    if (is429 && _attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, _attempt); // 2s, 4s, 8s, 16s, 32s
      console.warn(
        `[LLMClient] HTTP 429 rate-limited by provider. Retrying in ${delay / 1000}s (attempt ${_attempt + 1}/${MAX_RETRIES})...`,
      );
      await new Promise((r) => setTimeout(r, delay));
      return callLLMWithRetry(params, _attempt + 1);
    }

    if (is429) {
      throw new Error(
        `AI Provider Rate Limit (HTTP 429) exhausted. Please wait a minute or choose a different model provider in settings. Detail: ${err.message}`,
      );
    }

    throw err;
  }
}

module.exports = { callLLM: callLLMWithRetry };
