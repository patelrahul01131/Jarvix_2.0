const axios = require("axios");

async function streamChatCompletion(
  req,
  res,
  messages,
  system,
  selectedModel,
  selectedProvider,
) {
  // System prompt injection
  const fullSystemPrompt =
    system +
    `\n\nYou are Jarvix, an Elite Principal Software Architect and Senior Full-Stack Engineer. If (and only if) someone explicitly asks who your author, creator, or developer is, state that it is Rahul Patel, a MERN stack developer from Visnagar, and share his Instagram handle (@patelrahul01131). Otherwise proceed normally.
You have FULL access to the user's workspace filesystem. You can read, write, and create files. The workspace file list and file contents are provided in every message.
Be highly efficient, direct, and concise. Avoid conversational fluff unless necessary.`;

  let url = "";
  let headers = { "Content-Type": "application/json" };
  const isClaude = selectedProvider === "claude";

  switch (selectedProvider) {
    case "gemini":
      url =
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      const geminiKey = (process.env.GEMINI_API_KEY || "")
        .replace(/["']/g, "")
        .trim();
      if (!geminiKey)
        throw new Error("GEMINI_API_KEY is missing or empty in .env");
      headers["Authorization"] = `Bearer ${geminiKey}`;
      break;
    case "chatgpt":
      url = "https://api.openai.com/v1/chat/completions";
      headers["Authorization"] = `Bearer ${process.env.CHATGPT_API_KEY}`;
      break;
    case "groq":
      url = "https://api.groq.com/openai/v1/chat/completions";
      headers["Authorization"] = `Bearer ${process.env.GROK_API_KEY}`;
      break;
    case "claude":
      url = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = process.env.CLAUDE_API_KEY;
      headers["anthropic-version"] = "2023-06-01";
      break;
    case "openrouter":
      url = "https://openrouter.ai/api/v1/chat/completions";
      headers["Authorization"] = `Bearer ${process.env.OPEN_ROUTER_API_KEY}`;
      headers["HTTP-Referer"] = "http://localhost:3131";
      headers["X-Title"] = "Jarvix IDE";
      break;
    case "cerebras":
      url = "https://api.cerebras.ai/v1/chat/completions";
      headers["Authorization"] = `Bearer ${process.env.CEREBRAS_API_KEY}`;
      break;
    case "ollama":
      url = "http://localhost:11434/v1/chat/completions";
      if (process.env.OLLAMA_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.OLLAMA_API_KEY}`;
      }
      break;
    case "mistral":
      url = "https://api.mistral.ai/v1/chat/completions";
      headers["Authorization"] = `Bearer ${process.env.MISTRAL_API_KEY}`;
      break;
    default:
      url =
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      headers["Authorization"] = `Bearer ${process.env.GEMINI_API_KEY}`;
      break;
  }

  let body = {};
  if (isClaude) {
    body = {
      model: selectedModel,
      stream: true,
      max_tokens: 8192,
      system: fullSystemPrompt,
      messages: messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
    };
  } else {
    body = {
      model: selectedModel,
      stream: true,
      max_tokens: 8192,
      messages: [
        { role: "system", content: fullSystemPrompt },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      ],
    };
  }

  console.log(
    `[Jarvix OS] Requesting provider=${selectedProvider} model=${selectedModel}`,
  );

  const abortController = new AbortController();
  req.on("close", () => {
    // abortController.abort();
  });

  let apiResponse;
  try {
    apiResponse = await axios({
      method: "post",
      url,
      headers,
      data: body,
      responseType: "stream",
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      signal: abortController.signal,
    });
  } catch (err) {
    if (axios.isCancel(err)) {
      console.log("[Jarvix OS] Upstream request was aborted successfully.");
      return res.end();
    }
    console.error(`[Jarvix OS] Provider fetch failed:`, err.message);
    if (err.response && err.response.data) {
      return res
        .status(err.response.status || 500)
        .json({ error: `AI Provider Error: ${err.message}` });
    }
    throw new Error(
      `AI Provider connection failed: ${err.message}. Network issue or timeout.`,
    );
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let buffer = "";
  let capturedUsage = null;

  apiResponse.data.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;

      const dataStr = trimmed.replace(/^data:\s*/, "");
      if (dataStr === "[DONE]") {
        if (capturedUsage && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ usage: capturedUsage })}\n\n`);
        }
        if (!res.writableEnded) res.write("data: [DONE]\n\n");
        continue;
      }

      try {
        const json = JSON.parse(dataStr);
        let text = "";
        if (isClaude) {
          if (json.type === "content_block_delta" && json.delta?.text) {
            text = json.delta.text;
          }
          if (json.type === "message_delta" && json.usage) {
            capturedUsage = json.usage;
          }
        } else {
          text = json.choices?.[0]?.delta?.content;
          if (json.usage) {
            capturedUsage = json.usage;
          }
        }

        if (text && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      } catch (e) {}
    }
  });

  apiResponse.data.on("end", () => {
    if (!res.writableEnded) res.end();
  });

  apiResponse.data.on("error", (err) => {
    console.error("[Jarvix OS] Stream error:", err);
    if (!res.writableEnded) res.end();
  });
}

module.exports = { streamChatCompletion };
