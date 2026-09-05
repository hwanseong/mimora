import {
  effectiveSecurityLabels,
  type AIMode,
  type EffectiveSecurity,
} from '../security/securityRouter';

export function ChatHeader({
  workspaceLabel,
  aiMode,
  effectiveSecurity,
  disabled = false,
  onChangeAIMode,
}: {
  workspaceLabel: string;
  aiMode: AIMode;
  effectiveSecurity: EffectiveSecurity;
  disabled?: boolean;
  onChangeAIMode: (aiMode: AIMode) => void;
}) {
  return (
    <header className="chat-header">
      <div>
        <p className="eyebrow">현재 Workspace</p>
        <h1>{workspaceLabel}</h1>
      </div>

      <div className="header-meta" aria-label="채팅 설정">
        <label className="ai-mode-control">
          <span>AI Mode</span>
          <select
            aria-label="AI Mode"
            disabled={disabled}
            onChange={(event) => {
              onChangeAIMode(event.target.value as AIMode);
            }}
            value={aiMode}
          >
            <option value="auto">Auto</option>
            <option value="local">Local</option>
          </select>
        </label>
        <span className={`security-badge ${effectiveSecurity}`}>
          Security: {effectiveSecurityLabels[effectiveSecurity]}
        </span>
      </div>
    </header>
  );
}
