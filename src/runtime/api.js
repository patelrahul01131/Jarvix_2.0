const express = require("express");
const path = require("path");
const { streamChatCompletion } = require("./bridge");

const router = express.Router();

router.get("/logo", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "logo", "Jarvix_Logo.png"));
});

// We will rewire the state logic eventually to use our new Memory system
// For now, it maps back to the existing sessionStore so the UI doesn't break during migration
router.post("/state", (req, res) => {
  try {
    const { sessionId, state } = req.body;
    // Update to use the new Memory layer
    const shortTerm = require("../memory/shortTerm.js"); 
    const session = shortTerm.getSession(sessionId);
    if (session) {
      session.stateSnapshot = state; // Or whatever property the state is saved as
      shortTerm.saveSession(sessionId, session);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/chat", async (req, res) => {
  try {
    const { messages, system, model, provider } = req.body;
    if (!messages) {
      return res.status(400).json({ error: "Missing messages in body" });
    }

    const selectedProvider = provider || "mistral";
    const selectedModel = model || "open-mistral-7b";

    // Call the bridge to stream response back
    await streamChatCompletion(
      req, 
      res, 
      messages, 
      system, 
      selectedModel, 
      selectedProvider
    );

  } catch (err) {
    console.error("[Jarvix OS] Route error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
