const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const dns = require("dns");
const apiRouter = require("./api");

// Force IPv4 first to avoid localhost mapping issues on some Windows setups
dns.setDefaultResultOrder("ipv4first");
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

// Log which API keys are configured on startup
const keyStatus = {
  GEMINI: !!process.env.GEMINI_API_KEY,
  GROQ: !!process.env.GROK_API_KEY,
  OPENROUTER: !!process.env.OPEN_ROUTER_API_KEY,
  MISTRAL: !!process.env.MISTRAL_API_KEY,
};
console.log("[Jarvix OS] API Keys loaded:", keyStatus);

// Mount API routes
app.use("/", apiRouter);

const PORT = 3131;
const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Jarvix OS] Bridge running on http://127.0.0.1:${PORT}`);
});

// Configure timeouts for long-running LLM streams
server.setTimeout(600000); // 10 minutes
server.keepAliveTimeout = 600000;
server.headersTimeout = 600000;

module.exports = { app, server };
