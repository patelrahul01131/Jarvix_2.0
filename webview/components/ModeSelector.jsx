const MODES = [
  { id: 'write',   label: 'Write Code' },
  { id: 'analyze', label: 'Analyze'    },
  { id: 'review',  label: 'Review'     },
  { id: 'qa',      label: 'QA / Tests' },
];

export default function ModeSelector({ activeMode, onModeChange }) {
  return (
    <div className="mode-selector">
      {MODES.map(mode => (
        <button
          key={mode.id}
          className={`mode-btn ${activeMode === mode.id ? 'active' : ''}`}
          onClick={() => onModeChange(mode.id)}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}