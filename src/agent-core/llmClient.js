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
      model: model || "unknown",
      modelParameters: { provider },
      messages: [{ role: "system", content: system }, ...(messages || [])],
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

module.exports = { callLLM };
