import React from 'react';

const PROVIDERS = [
  { id: 'openrouter', label: 'Open Router', icon: '🔀' },
  { id: 'gemini',     label: 'Gemini',      icon: '♊' },
  { id: 'groq',       label: 'Groq',        icon: '⚡' },
  { id: 'ollama',     label: 'Ollama',      icon: '🦙' },
  { id: 'mistral',    label: 'Mistral',     icon: '🌪️' },
];

const MODELS_BY_PROVIDER = {
  openrouter: [
    { id: 'qwen/qwen3-coder:free',                    label: 'Qwen3 Coder (Free)' },
    { id: 'moonshotai/kimi-k2.6:free',                label: 'Kimi K2.6 (Free)' },
    { id: 'openai/gpt-oss-120b:free',                 label: 'GPT-OSS 120B (Free)' },
    { id: 'poolside/laguna-m.1:free',                 label: 'Laguna M.1 (Free)' },
    { id: 'nvidia/nemotron-3-super-120b-a12b:free',   label: 'Nemotron 120B (Free)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',   label: 'Llama 3.3 70B (Free)' },
    { id: 'google/gemma-4-31b-it:free',               label: 'Gemma 4 31B (Free)' },
    { id: 'openai/gpt-oss-20b:free',                  label: 'GPT-OSS 20B (Free)' },
  ],
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
    { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B' },
    { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it',            label: 'Gemma 2 9B' },
  ],
  ollama: [
    { id: 'llama3',    label: 'Llama 3' },
    { id: 'mistral',   label: 'Mistral' },
    { id: 'codellama', label: 'CodeLlama' },
  ],
  mistral: [
    { id: 'open-mistral-7b',      label: 'Open Mistral 7B' },
    { id: 'mistral-tiny',         label: 'Mistral Tiny' },
    { id: 'mistral-small-latest', label: 'Mistral Small' },
  ],
};

export default function ModelSelector({ activeProvider, activeModel, onProviderChange, onModelChange, disabled }) {
  const models = MODELS_BY_PROVIDER[activeProvider] || [];
  const currentProvider = PROVIDERS.find(p => p.id === activeProvider);
  const currentModel = models.find(m => m.id === activeModel);

  const handleProviderSelect = (e) => {
    const provider = e.target.value;
    onProviderChange(provider);
    const firstModel = MODELS_BY_PROVIDER[provider]?.[0]?.id || '';
    onModelChange(firstModel);
  };

  return (
    <div className="model-selector-container">
      <div className="selector-group">
        <label className="model-label">
          <span>{currentProvider?.icon || '🤖'}</span> AI:
        </label>
        <select
          value={activeProvider}
          onChange={handleProviderSelect}
          className="model-select"
          disabled={disabled}
        >
          {PROVIDERS.map(p => (
            <option key={p.id} value={p.id}>
              {p.icon} {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="selector-group">
        <label className="model-label">Model:</label>
        <select
          value={activeModel}
          onChange={e => onModelChange(e.target.value)}
          className="model-select"
          disabled={disabled}
        >
          {models.map(model => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </div>

      {/* Active model pill */}
      {currentModel && (
        <div style={{
          fontSize: '10px',
          background: 'var(--accent-dim)',
          color: 'var(--accent)',
          border: '1px solid rgba(124,106,247,0.25)',
          borderRadius: '10px',
          padding: '2px 8px',
          fontWeight: 600,
          letterSpacing: '0.02em',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ opacity: 0.7 }}>●</span>
          {currentModel.label}
        </div>
      )}
    </div>
  );
}
