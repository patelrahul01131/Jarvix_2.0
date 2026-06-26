import React, { useState, useRef, useEffect } from "react";
import { useStore } from "../store";

const PROVIDERS = [
  { id: "openrouter", label: "Open Router", icon: "🔀" },
  { id: "github", label: "GitHub", icon: "🤖" },
  { id: "gemini", label: "Gemini", icon: "♊" },
  { id: "groq", label: "Groq", icon: "⚡" },
  { id: "ollama", label: "Ollama", icon: "🦙" },
  { id: "mistral", label: "Mistral", icon: "🌪️" },
];

const MODELS_BY_PROVIDER = {
  openrouter: [
    { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder (Free)" },
    { id: "moonshotai/kimi-k2.6:free", label: "Kimi K2.6 (Free)" },
    { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B (Free)" },
    { id: "poolside/laguna-m.1:free", label: "Laguna M.1 (Free)" },
    {
      id: "nvidia/nemotron-3-super-120b-a12b:free",
      label: "Nemotron 120B (Free)",
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      label: "Llama 3.3 70B (Free)",
    },
    { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B (Free)" },
    { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B (Free)" },
  ],
  github: [
    { id: "openai/gpt-4.1", label: "GPT-4.1" },
    { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { id: "openai/gpt-4o", label: "GPT-4o" },
    { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    { id: "deepseek/deepseek-r1", label: "DeepSeek R1" },
    { id: "mistral/mistral-large", label: "Mistral Large" },
    { id: "microsoft/phi-4", label: "Phi-4" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
    { id: "gemma2-9b-it", label: "Gemma 2 9B" },
  ],
  ollama: [
    { id: "llama3", label: "Llama 3" },
    { id: "mistral", label: "Mistral" },
    { id: "codellama", label: "CodeLlama" },
  ],
  mistral: [
    { id: "open-mistral-7b", label: "Open Mistral 7B" },
    { id: "mistral-tiny", label: "Mistral Tiny" },
    { id: "mistral-small-latest", label: "Mistral Small" },
  ],
};
export default function Composer({ onSend, onStop, isLoading, agentStatus }) {
  const store = useStore();
  const [text, setText] = useState("");
  const textareaRef = useRef(null);

  const autoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    autoResize();
  }, [text]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend("ask");
    }
  };

  const handleSend = (mode = "ask") => {
    console.log(
      "[Jarvix Debug] Composer handleSend called with text:",
      text,
      "mode:",
      mode,
    );
    if (!text.trim()) {
      console.log("[Jarvix Debug] Composer handleSend aborted: text is empty.");
      return;
    }
    if (onSend) {
      console.log("[Jarvix Debug] Composer calling onSend prop.");
      onSend(text.trim(), mode);
    } else {
      console.log("[Jarvix Debug] Composer onSend prop is NOT defined!");
    }
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const isExecuting =
    isLoading ||
    (agentStatus &&
      !agentStatus.toLowerCase().includes("idle") &&
      !agentStatus.toLowerCase().includes("completed") &&
      !agentStatus.toLowerCase().includes("error") &&
      !agentStatus.toLowerCase().includes("failed"));

  return (
    <div className="composer-container">
      <div
        className="composer-model-selectors"
        style={{ display: "flex", gap: "8px", marginBottom: "8px" }}
      >
        <select
          className="model-select"
          value={store.activeProvider}
          onChange={(e) => {
            const newProvider = e.target.value;
            store.setActiveProvider(newProvider);
            if (
              MODELS_BY_PROVIDER[newProvider] &&
              MODELS_BY_PROVIDER[newProvider].length > 0
            ) {
              store.setActiveModel(MODELS_BY_PROVIDER[newProvider][0].id);
            }
          }}
          style={{
            flex: 1,
            background: "var(--bg-elevated)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "4px",
            fontSize: "11px",
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.label}
            </option>
          ))}
        </select>

        <select
          className="model-select"
          value={store.activeModel}
          onChange={(e) => store.setActiveModel(e.target.value)}
          style={{
            flex: 1,
            background: "var(--bg-elevated)",
            color: "var(--fg)",
            border: "1px solid var(--border)",
            borderRadius: "4px",
            padding: "4px",
            fontSize: "11px",
          }}
        >
          {(MODELS_BY_PROVIDER[store.activeProvider] || []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <div className="composer-inner">
        <div className="composer-input-wrapper">
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            placeholder="Ask Jarvix anything (Shift+Enter for newline)..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            rows={1}
          />
          <div className="composer-attachments">
            <button
              className="attach-btn"
              title="Attach file or image"
              disabled={isExecuting}
            >
              <i className="codicon codicon-paperclip"></i>
            </button>
          </div>
        </div>
        <div className="composer-actions">
          {isExecuting ? (
            <button
              className="composer-btn stop"
              onClick={onStop}
              title="Stop execution"
            >
              <i className="codicon codicon-debug-stop"></i> Stop
            </button>
          ) : (
            <>
              <button
                className="composer-btn plan"
                onClick={() => handleSend("plan")}
                disabled={!text.trim()}
                title="Generate a plan first"
              >
                <i className="codicon codicon-list-flat"></i> Plan
              </button>
              <button
                className="composer-btn ask"
                onClick={() => handleSend("ask")}
                disabled={!text.trim()}
                title="Execute immediately"
              >
                <i className="codicon codicon-send"></i> Ask
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
