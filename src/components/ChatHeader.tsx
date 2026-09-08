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
  includeArchived = false,
  onChangeAIMode,
  onChangeIncludeArchived,
  searchScopeDisabled = false,
  showSearchScope = false,
}: {
  workspaceLabel: string;
  aiMode: AIMode;
  effectiveSecurity: EffectiveSecurity;
  disabled?: boolean;
  includeArchived?: boolean;
  onChangeAIMode: (aiMode: AIMode) => void;
  onChangeIncludeArchived?: (includeArchived: boolean) => void;
  searchScopeDisabled?: boolean;
  showSearchScope?: boolean;
}) {
  return (
    <header className="chat-header">
      <div className="workspace-heading">
        <p className="eyebrow">현재 Workspace</p>
        <h1>{workspaceLabel}</h1>
        {showSearchScope ? (
          <label
            className="archived-search-toggle"
            title="Archived Workspace에 연결된 문서까지 검색합니다."
          >
            <input
              checked={includeArchived}
              disabled={searchScopeDisabled || !onChangeIncludeArchived}
              onChange={(event) => {
                onChangeIncludeArchived?.(event.target.checked);
              }}
              type="checkbox"
            />
            <span>과거 업무 포함</span>
          </label>
        ) : null}
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
            <option value="external">External</option>
          </select>
        </label>
        <span className={`security-badge ${effectiveSecurity}`}>
          Security: {effectiveSecurityLabels[effectiveSecurity]}
        </span>
      </div>
    </header>
  );
}
