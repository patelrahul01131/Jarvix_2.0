const path = require("path");
const fs = require("fs");

// ─── Bootstrap: fix workspace root & create all .jarvix dirs ──────────────────
// Must run BEFORE dotenv so other modules can rely on a correct env var.
(function bootstrapWorkspace() {
  const dotenv = require("dotenv");
  dotenv.config(); // load .env first so we can read JARVIX_WORKSPACE_ROOT

  const envRoot = process.env.JARVIX_WORKSPACE_ROOT;

  // Accept only absolute paths — reject placeholders like "root", "", etc.
  const isAbsolute = envRoot && path.isAbsolute(envRoot);
  const workspaceRoot = isAbsolute ? envRoot : process.cwd();

  // Always normalise and publish the corrected value so every module sees it
  process.env.JARVIX_WORKSPACE_ROOT = workspaceRoot;

  // Create all required .jarvix subdirectories
  const subdirs = [
    ".jarvix",
    ".jarvix/chats",
    ".jarvix/lancedb",
    ".jarvix/checkpoints",
    ".jarvix/backups",
    ".jarvix/logs",
    ".jarvix/telemetry",
  ];
  for (const sub of subdirs) {
    const fullPath = path.join(workspaceRoot, sub);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`[Jarvix OS] Created: ${fullPath}`);
    }
  }

  console.log(`[Jarvix OS] Workspace root: ${workspaceRoot}`);
})();
// ──────────────────────────────────────────────────────────────────────────────

const express = require("express");
const cors = require("cors");
const dns = require("dns");
const helmet = require("helmet");
const apiRouter = require("./api");
const { rateLimiter } = require("../modules/auth/rate_limit");

// Initialize memory stores (after workspace root is set)
require("../memory/database");

// Force IPv4 first to avoid localhost mapping issues on some Windows setups
dns.setDefaultResultOrder("ipv4first");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.EXTENSION_ORIGIN
        : "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

// Apply rate limiter globally to all API routes
app.use(rateLimiter());

// Log which API keys are configured on startup
const keyStatus = {
  GEMINI: !!process.env.GEMINI_API_KEY,
  GROQ: !!process.env.GROK_API_KEY,
  OPENROUTER: !!process.env.OPEN_ROUTER_API_KEY,
  MISTRAL: !!process.env.MISTRAL_API_KEY,
  GITHUB: !!process.env.GITHUB_API_KEY,
  KIMI: !!process.env.KIMI_API_KEY,
  DEEPSEEK: !!process.env.DEEPSEEK_API_KEY,
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
